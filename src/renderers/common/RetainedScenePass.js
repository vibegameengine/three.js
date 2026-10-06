import { Vector4 } from '../../math/Vector4.js';
import { DynamicDrawUsage } from '../../constants.js';
import { listenForDirtyBuffers, takeDirtyBuffers } from '../../core/DrawListRevision.js';
import { AttributeType } from './Constants.js';
import RetainedDrawList from './RetainedDrawList.js';
import RetainedCulling, { ARGS_STRIDE } from './RetainedCulling.js';
import RetainedTransparents from './RetainedTransparents.js';

const _depth = /*@__PURE__*/ new Vector4();

function bufferOf( attribute ) {

	return attribute.isInterleavedBufferAttribute ? attribute.data : attribute;

}

class RetainedScenePass {

	constructor() {

		this.list = new RetainedDrawList();
		this.transparents = new RetainedTransparents();
		this.culling = null;
		this.bundleGroup = { version: 0, static: true };
		this.encoded = { listVersion: - 1, context: null, contextNode: null, contextNodeVersion: - 1 };
		this.representatives = [];
		this.bindGroups = new Map();
		this.uploads = new Map();
		this.dynamicUploads = [];
		this.gpuBuffers = new Map();
		this.bindings = [];
		this.dirty = [];
		this.reencode = true;
		this.stopListening = listenForDirtyBuffers();

	}

	collectFrame( renderer, scene, camera, renderContext, renderList, frustum, projScreenMatrix ) {

		if ( renderer.gpuScene === null || renderer.gpuScene === undefined ) throw new Error( 'RetainedScenePass: the renderer needs a GpuScene; retained draws read every transform from it.' );
		if ( camera.isArrayCamera === true ) throw new Error( 'RetainedScenePass: an ArrayCamera is not supported; the GPU culls against one frustum.' );

		this._updateLods( camera );
		if ( this.list.isCurrent( scene, camera ) === false ) this._rebuild( renderer, scene, camera, renderContext );

		for ( const light of this.list.lights ) renderList.pushLight( light );

		this._pushVisible( this.list.direct, renderList, renderContext, frustum, projScreenMatrix, camera );

	}

	syncAndCull( renderer, gpuSceneFrame, frustum ) {

		const gpuScene = renderer.gpuScene;

		for ( const item of this.list.items ) gpuScene.sync( item.object, gpuSceneFrame );
		for ( const item of this.list.transparent ) gpuScene.sync( item.object, gpuSceneFrame );

		renderer._flushGpuScene();

		if ( this.culling.stale ) this._replaceCulling( renderer );

		this._uploadChangedBuffers( renderer );

		if ( this.culling.drawsKnown === false ) return;

		this.culling.aim( frustum );
		renderer.compute( this.culling.node );

	}

	draw( renderer, sceneRef, lightsNode, renderContext, camera ) {

		if ( this._needsEncode( renderer, renderContext ) === false ) {

			for ( const object of this.list.callbacks ) object.onBeforeRender( renderer, sceneRef, camera, object.geometry, object.material, null );

			this._refreshRepresentatives( renderer );

			if ( this._bindGroupsChanged( renderer ) === false ) {

				renderer.backend.drawBundle( renderContext, this.renderBundle );
				for ( const object of this.list.callbacks ) object.onAfterRender( renderer, sceneRef, camera, object.geometry, object.material, null );
				return;

			}

			this.reencode = true;

		}

		this._encode( renderer, sceneRef, lightsNode, renderContext, camera );

	}

	drawTransparent( renderer, { sceneRef, lightsNode, renderContext, camera, frustum, projScreenMatrix } ) {

		const encodeKey = `${ renderContext.id }:${ renderer.contextNode.id }:${ renderer.contextNode.version }:${ this.list.version }`;
		this.transparents.draw( renderer, { sceneRef, lightsNode, renderContext, camera, frustum, projScreenMatrix, encodeKey } );

	}

	dispose() {

		this._unbind();
		this.stopListening();

	}

	_updateLods( camera ) {

		for ( const lod of this.list.lods ) if ( lod.autoUpdate === true ) lod.update( camera );

	}

	_rebuild( renderer, scene, camera, renderContext ) {

		this.list.build( scene, camera );
		this._updateLods( camera );
		if ( this.list.isCurrent( scene, camera ) === false ) this.list.build( scene, camera );

		for ( const item of this.list.items ) item.clippingContext = renderContext.clippingContext;

		this._unbind();
		this.culling = new RetainedCulling( renderer.gpuScene, this.list.items.length );
		this._describeItems( renderer, camera, renderContext );
		for ( const item of this.list.transparent ) item.clippingContext = renderContext.clippingContext;
		this.transparents.rebuild( this.list.transparent );
		this.reencode = true;

	}

	_replaceCulling( renderer ) {

		const previous = this.culling;
		this.culling = new RetainedCulling( renderer.gpuScene, previous.count );
		this.culling.spheres.array.set( previous.spheres.array );
		this.culling.primitives.array.set( previous.primitives.array );
		this.culling.instances.array.set( previous.instances.array );
		this.culling.args.array.set( previous.args.array );
		this.culling.drawsKnown = previous.drawsKnown;
		this.culling.upload();
		for ( const { binding } of this.bindings ) binding.indirect = this.culling.args;
		this.reencode = true;

	}

	_describeItems( renderer, camera, renderContext ) {

		const gpuScene = renderer.gpuScene;
		const bindingOf = new Map();

		this.list.items.forEach( ( item, index ) => {

			const { object, geometry } = item;
			if ( geometry.boundingSphere === null ) geometry.computeBoundingSphere();
			const alwaysDrawn = object.frustumCulled === false || object.isSkinnedMesh === true || object.isSprite === true;
			this.culling.describe( index, { sphere: geometry.boundingSphere, primitive: gpuScene.primitiveOf( object ).id, alwaysDrawn } );

			if ( object.instanceCulling !== undefined && object.instanceCulling !== null && object.instanceCulling.retained !== true ) return;

			let binding = bindingOf.get( object );

			if ( binding === undefined ) {

				binding = { camera, context: renderContext, indirect: this.culling.args, indirectOffset: 0, instanceIds: null, idBase: 0, groupOffsets: new Map(), retained: true };
				bindingOf.set( object, binding );
				object.instanceCulling = binding;
				this.bindings.push( { object, binding } );

			}

			binding.groupOffsets.set( item.group, index * ARGS_STRIDE );

		} );

	}

	_unbind() {

		for ( const { object, binding } of this.bindings ) if ( object.instanceCulling === binding ) object.instanceCulling = null;

		this.bindings.length = 0;

	}

	_pushVisible( items, renderList, renderContext, frustum, projScreenMatrix, camera ) {

		for ( const item of items ) {

			const { object, geometry, material, group, groupOrder } = item;
			const visible = object.frustumCulled === false || ( object.isSprite === true ? frustum.intersectsSprite( object, camera ) : frustum.intersectsObject( object, camera ) );
			if ( visible === false ) continue;

			if ( geometry.boundingSphere === null ) geometry.computeBoundingSphere();
			_depth.copy( geometry.boundingSphere.center ).applyMatrix4( object.matrixWorld ).applyMatrix4( projScreenMatrix );
			renderList.push( object, geometry, material, groupOrder, _depth.z, group, renderContext.clippingContext );

		}

	}

	_needsEncode( renderer, renderContext ) {

		const encoded = this.encoded;

		if ( this.reencode || this.renderBundle === undefined ) return true;
		if ( renderer.backend.get( this.renderBundle ).version !== this.bundleGroup.version ) return true;

		return encoded.listVersion !== this.list.version || encoded.context !== renderContext || encoded.contextNode !== renderer.contextNode || encoded.contextNodeVersion !== renderer.contextNode.version;

	}

	_encode( renderer, sceneRef, lightsNode, renderContext, camera ) {

		this.bundleGroup.version ++;
		const renderList = { opaque: this.list.items, transparent: [], transparentDoublePass: [] };
		renderer._renderBundle( { bundleGroup: this.bundleGroup, camera, renderList }, sceneRef, lightsNode, true );

		this.renderBundle = renderer._bundles.get( this.bundleGroup, camera );
		const renderObjects = renderer.backend.get( this.renderBundle ).renderObjects;
		if ( renderObjects.length !== this.list.items.length ) throw new Error( `RetainedScenePass: encoded ${ renderObjects.length } draws for ${ this.list.items.length } retained items.` );

		renderObjects.forEach( ( renderObject, index ) => this.culling.writeDraw( index, renderObject.getDrawParameters() ) );
		this.culling.drawsKnown = true;
		this.culling.upload();
		renderer._attributes.update( this.culling.args, AttributeType.INDIRECT );
		renderer._attributes.update( this.culling.instances, AttributeType.STORAGE );

		this._remember( renderer, renderObjects );

		const encoded = this.encoded;
		encoded.listVersion = this.list.version;
		encoded.context = renderContext;
		encoded.contextNode = renderer.contextNode;
		encoded.contextNodeVersion = renderer.contextNode.version;
		this.reencode = false;

	}

	_remember( renderer, renderObjects ) {

		const backend = renderer.backend;
		const sharedBindings = new Set();

		this.representatives.length = 0;
		this.bindGroups.clear();
		this.uploads.clear();
		this.dynamicUploads.length = 0;
		this.gpuBuffers.clear();

		for ( const renderObject of renderObjects ) {

			const materialBindings = renderObject.getMaterialBindings();

			if ( materialBindings === null ) this.representatives.push( renderObject );
			else if ( sharedBindings.has( materialBindings ) === false ) {

				sharedBindings.add( materialBindings );
				this.representatives.push( renderObject );

			}

			for ( const bindGroup of renderObject.getBindings() ) this.bindGroups.set( bindGroup, backend.get( bindGroup ).group );

			for ( const attribute of renderObject.getAttributes() ) this._rememberUpload( renderer, attribute, attribute.isStorageBufferAttribute || attribute.isStorageInstancedBufferAttribute ? AttributeType.STORAGE : AttributeType.VERTEX );

			const index = renderer._geometries.getIndex( renderObject );
			if ( index !== null ) this._rememberUpload( renderer, index, AttributeType.INDEX );

		}

	}

	_rememberUpload( renderer, attribute, type ) {

		const buffer = bufferOf( attribute );
		let uploads = this.uploads.get( buffer );

		if ( uploads === undefined ) {

			uploads = [];
			this.uploads.set( buffer, uploads );

		}

		if ( uploads.some( ( upload ) => upload.attribute === attribute ) ) return;

		const upload = { attribute, type };
		uploads.push( upload );
		if ( buffer.usage === DynamicDrawUsage ) this.dynamicUploads.push( upload );
		this.gpuBuffers.set( attribute, renderer.backend.get( attribute ).buffer );

	}

	_uploadChangedBuffers( renderer ) {

		const dirty = takeDirtyBuffers( this.dirty );

		for ( const buffer of dirty ) {

			const uploads = this.uploads.get( buffer );
			if ( uploads !== undefined ) for ( const upload of uploads ) this._upload( renderer, upload );

		}

		dirty.length = 0;

		for ( const upload of this.dynamicUploads ) this._upload( renderer, upload );

	}

	_upload( renderer, { attribute, type } ) {

		renderer._attributes.update( attribute, type );

		if ( renderer.backend.get( attribute ).buffer !== this.gpuBuffers.get( attribute ) ) this.reencode = true;

	}

	_refreshRepresentatives( renderer ) {

		const nodes = renderer._nodes;
		const bindings = renderer._bindings;

		for ( const renderObject of this.representatives ) {

			if ( nodes.needsRefresh( renderObject ) && renderer._refreshedWithMaterial( renderObject ) === false ) {

				nodes.updateBefore( renderObject );
				nodes.updateForRender( renderObject );
				bindings.updateForRender( renderObject );
				nodes.updateAfter( renderObject );

			}

		}

	}

	_bindGroupsChanged( renderer ) {

		const backend = renderer.backend;

		for ( const [ bindGroup, group ] of this.bindGroups ) if ( backend.get( bindGroup ).group !== group ) return true;

		return false;

	}

}

export default RetainedScenePass;

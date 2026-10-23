import { Vector4 } from '../../math/Vector4.js';
import { AttributeType } from './Constants.js';
import RetainedDrawList from './RetainedDrawList.js';
import RetainedCulling, { ARGS_STRIDE } from './RetainedCulling.js';
import RetainedSlots from './RetainedSlots.js';
import RetainedChunks from './RetainedChunks.js';
import { drawSlotKey, drawnAtThisSize } from './ScreenSizeLods.js';
import RetainedTransparents from './RetainedTransparents.js';
import RetainedUploads from './RetainedUploads.js';
import { SteadyUniformSources } from './SteadyUniforms.js';
import RetainedViewRefresh, { refreshFully, refreshShared } from './RetainedViewRefresh.js';

const _depth = /*@__PURE__*/ new Vector4();
const _pipelineOrderOff = new URLSearchParams( globalThis.location?.search ?? '' ).get( 'pipelineOrder' ) === '0';
const _inListOrder = ( a, b ) => a.listIndex - b.listIndex;

function shownInWorld( object ) {

	for ( let node = object; node !== null; node = node.parent ) if ( node.visible === false ) return false;

	return true;

}

class RetainedScenePass {

	constructor() {

		this.list = new RetainedDrawList();
		this.rasterBins = null;
		this.transparents = new RetainedTransparents();
		this.culling = null;
		this.slots = new RetainedSlots();
		this.chunks = new RetainedChunks();
		this.encoded = { context: null, contextNode: null, contextNodeVersion: - 1 };
		this.representatives = [];
		this.viewRefresh = new RetainedViewRefresh();
		this.calledBack = new Set();
		this.bindingOf = new Map();
		this.geometryUploads = new RetainedUploads();
		this.reencode = true;
		this.sortByPipeline = false;

	}

	collectFrame( renderer, scene, camera, renderContext, renderList, frustum, projScreenMatrix, lodView = camera ) {

		if ( renderer.gpuScene === null || renderer.gpuScene === undefined ) throw new Error( 'RetainedScenePass: the renderer needs a GpuScene; retained draws read every transform from it.' );
		if ( camera.isArrayCamera === true ) throw new Error( 'RetainedScenePass: an ArrayCamera is not supported; the GPU culls against one frustum.' );

		this._updateLods( camera );
		if ( this.sortByPipeline === true || this.list.isCurrent( scene, camera, this.rasterBins ) === false ) {

			this.sortByPipeline = false;
			this._rebuild( renderer, scene, camera, renderContext );

		} else this._applyVisibility( scene );

		for ( const light of this.list.lights ) if ( shownInWorld( light ) ) renderList.pushLight( light );

		this._pushVisible( this.list.direct, renderList, renderContext, { frustum, projScreenMatrix, camera, lodView } );

	}

	syncAndCull( renderer, gpuSceneFrame, frustum, camera ) {

		const gpuScene = renderer.gpuScene;

		gpuScene.syncMoved( gpuSceneFrame );

		renderer._flushGpuScene();

		if ( this.culling.stale ) this.culling.followRecords();

		this._uploadChangedBuffers( renderer );

		if ( this.culling.drawsKnown === false ) return;

		this.culling.aim( frustum, camera );
		renderer.compute( this.culling.node, Math.max( 1, this.slots.capacity ) );

	}

	draw( renderer, sceneRef, lightsNode, renderContext, camera ) {

		if ( this.reencode || this._contextChanged( renderer, renderContext ) ) this.chunks.markAllDirty();

		const chunks = this.chunks.chunks;
		const backend = renderer.backend;

		for ( const chunk of chunks ) if ( chunk.renderBundle === undefined || backend.get( chunk.renderBundle ).version !== chunk.bundleGroup.version ) chunk.dirty = true;

		const recorded = this._objectsOf( chunks.filter( ( chunk ) => chunk.dirty ) );
		const replayed = this.list.callbacks.filter( ( object ) => recorded.has( object ) === false );

		for ( const object of replayed ) object.onBeforeRender( renderer, sceneRef, camera, object.geometry, object.material, null );

		this._refreshRepresentatives( renderer );

		for ( const chunk of chunks ) if ( chunk.dirty === false && this._bindGroupsChanged( renderer, chunk ) ) chunk.dirty = true;

		let encoded = false;

		for ( const chunk of chunks ) {

			if ( chunk.dirty ) {

				this._encodeChunk( renderer, { sceneRef, lightsNode, camera }, chunk );
				encoded = true;

			} else backend.drawBundle( renderContext, chunk.renderBundle );

		}

		for ( const object of replayed ) object.onAfterRender( renderer, sceneRef, camera, object.geometry, object.material, null );

		if ( encoded ) this._afterEncode( renderer, renderContext );

	}

	drawTransparent( renderer, { sceneRef, lightsNode, renderContext, camera, frustum, projScreenMatrix, lodView } ) {

		const encodeKey = `${ renderContext.id }:${ renderer.contextNode.id }:${ renderer.contextNode.version }:${ this.list.version }`;
		this.transparents.draw( renderer, { sceneRef, lightsNode, renderContext, camera, frustum, projScreenMatrix, encodeKey, lodView } );

	}

	dispose() {

		this._unbind();
		this.viewRefresh.release();
		this.transparents.dispose();
		this.geometryUploads.dispose();

	}

	_updateLods( camera ) {

		for ( const lod of this.list.lods ) if ( lod.autoUpdate === true ) lod.update( camera );

	}

	_applyVisibility( scene ) {

		for ( const draw of this.list.applyVisibility( scene ) ) if ( draw.cullIndex !== undefined ) this.culling.hide( draw.cullIndex, draw.hidden );

	}

	_rebuild( renderer, scene, camera, renderContext ) {

		this.list.build( scene, camera, this.rasterBins );
		this._updateLods( camera );
		if ( this.list.isCurrent( scene, camera, this.rasterBins ) === false ) this.list.build( scene, camera, this.rasterBins );

		this.list.items.forEach( ( item, index ) => {

			item.clippingContext = renderContext.clippingContext;
			item.listIndex = index;

		} );

		const { removed } = this.slots.assign( this.list.items );
		this._reserveCulling( renderer );
		for ( const slot of removed ) this.culling.release( slot );
		this._describeItems( renderer, camera, renderContext );
		this.culling.upload();
		this.chunks.assign( this.list.items, _inListOrder );
		for ( const item of this.list.transparent ) item.clippingContext = renderContext.clippingContext;
		this.transparents.rebuild( this.list.transparent );

	}

	_reserveCulling( renderer ) {

		if ( this.culling === null ) {

			this.culling = new RetainedCulling( renderer.gpuScene, this.slots.capacity );
			return;

		}

		if ( this.culling.reserve( this.slots.capacity ) === false ) return;

		for ( const binding of this.bindingOf.values() ) binding.indirect = this.culling.args;
		this.reencode = true;

	}

	_describeItems( renderer, camera, renderContext ) {

		const gpuScene = renderer.gpuScene;
		const bound = new Set();

		for ( const item of this.list.items ) {

			const { object, band, slot } = item;
			const bounds = object.geometry;
			if ( bounds.boundingSphere === null ) bounds.computeBoundingSphere();
			const alwaysDrawn = object.frustumCulled === false || object.isSkinnedMesh === true || object.isSprite === true;
			this.culling.describe( slot, { sphere: bounds.boundingSphere, primitive: gpuScene.primitiveOf( object ).id, alwaysDrawn, band } );
			item.cullIndex = slot;
			this.culling.hidden[ slot ] = item.hidden ? 1 : 0;

			if ( object.instanceCulling !== undefined && object.instanceCulling !== null && object.instanceCulling.retained !== true ) continue;

			const binding = this._bindingFor( object, { camera, renderContext }, bound );
			binding.groupOffsets.set( drawSlotKey( item ), slot * ARGS_STRIDE );

		}

		for ( const [ object, binding ] of this.bindingOf ) {

			if ( bound.has( object ) ) continue;
			if ( object.instanceCulling === binding ) object.instanceCulling = null;
			this.bindingOf.delete( object );

		}

	}

	_bindingFor( object, { camera, renderContext }, bound ) {

		let binding = this.bindingOf.get( object );

		if ( binding === undefined ) {

			binding = { camera, context: renderContext, indirect: this.culling.args, indirectOffset: 0, instanceIds: null, idBase: 0, groupOffsets: new Map(), retained: true };
			this.bindingOf.set( object, binding );

		}

		if ( bound.has( object ) === false ) {

			bound.add( object );
			binding.camera = camera;
			binding.context = renderContext;
			binding.indirect = this.culling.args;
			binding.groupOffsets.clear();
			object.instanceCulling = binding;

		}

		return binding;

	}

	_unbind() {

		for ( const [ object, binding ] of this.bindingOf ) if ( object.instanceCulling === binding ) object.instanceCulling = null;

		this.bindingOf.clear();

	}

	_pushVisible( items, renderList, renderContext, { frustum, projScreenMatrix, camera, lodView } ) {

		for ( const item of items ) {

			if ( item.hidden === true || drawnAtThisSize( item, lodView ) === false ) continue;
			const { object, geometry, material, group, groupOrder } = item;
			const visible = object.frustumCulled === false || ( object.isSprite === true ? frustum.intersectsSprite( object, camera ) : frustum.intersectsObject( object, camera ) );
			if ( visible === false ) continue;

			if ( geometry.boundingSphere === null ) geometry.computeBoundingSphere();
			_depth.copy( geometry.boundingSphere.center ).applyMatrix4( object.matrixWorld ).applyMatrix4( projScreenMatrix );
			renderList.push( object, geometry, material, groupOrder, _depth.z, group, renderContext.clippingContext );

		}

	}

	_contextChanged( renderer, renderContext ) {

		const encoded = this.encoded;

		return encoded.context !== renderContext || encoded.contextNode !== renderer.contextNode || encoded.contextNodeVersion !== renderer.contextNode.version;

	}

	_objectsOf( chunks ) {

		const objects = new Set();

		for ( const chunk of chunks ) for ( const item of chunk.items ) objects.add( item.object );

		return objects;

	}

	_encodeChunk( renderer, { sceneRef, lightsNode, camera }, chunk ) {

		chunk.bundleGroup.version ++;
		const renderList = { opaque: chunk.items, transparent: [], transparentDoublePass: [] };
		renderer._renderBundle( { bundleGroup: chunk.bundleGroup, camera, renderList }, sceneRef, lightsNode, true );

		chunk.renderBundle = renderer._bundles.get( chunk.bundleGroup, camera, renderer._currentRenderContext );
		const renderObjects = renderer.backend.get( chunk.renderBundle ).renderObjects;
		if ( renderObjects.length !== chunk.items.length ) throw new Error( `RetainedScenePass: encoded ${ renderObjects.length } draws for ${ chunk.items.length } retained items.` );

		chunk.renderObjects = renderObjects.slice();
		renderObjects.forEach( ( renderObject, index ) => this.culling.writeDraw( chunk.items[ index ].slot, renderObject.getDrawParameters() ) );
		this._learnPipelineOrder( renderObjects );
		this._rememberBindGroups( renderer, chunk );
		chunk.dirty = false;

	}

	_afterEncode( renderer, renderContext ) {

		this.culling.drawsKnown = true;
		this.culling.upload();
		renderer._attributes.update( this.culling.args, AttributeType.INDIRECT );
		renderer._attributes.update( this.culling.instances, AttributeType.STORAGE );

		this._remember( renderer, this.chunks.chunks.flatMap( ( chunk ) => chunk.renderObjects ) );

		const encoded = this.encoded;
		encoded.context = renderContext;
		encoded.contextNode = renderer.contextNode;
		encoded.contextNodeVersion = renderer.contextNode.version;
		this.reencode = false;

	}

	_learnPipelineOrder( renderObjects ) {

		if ( _pipelineOrderOff ) return;

		let learnt = false;
		const seen = new Set();

		for ( const renderObject of renderObjects ) {

			if ( renderObject.pipeline === null || seen.has( renderObject.material ) ) continue;
			seen.add( renderObject.material );
			learnt = this.list.pipelines.remember( renderObject.material, renderObject.pipeline ) || learnt;

		}

		if ( learnt ) this.sortByPipeline = true;

	}

	_rememberBindGroups( renderer, chunk ) {

		const backend = renderer.backend;
		chunk.bindGroups.clear();

		for ( const renderObject of chunk.renderObjects ) {

			if ( renderer._nodes.hasNodeBuilderState( renderObject ) === false ) continue;
			for ( const bindGroup of renderObject.getBindings() ) chunk.bindGroups.set( bindGroup, backend.get( bindGroup ).group );

		}

	}

	_remember( renderer, encoded ) {

		const renderObjects = encoded.filter( ( renderObject ) => renderer._nodes.hasNodeBuilderState( renderObject ) );
		const sharedBindings = new Set();

		this.calledBack.clear();
		const callbacks = new Set( this.list.callbacks );

		for ( const renderObject of renderObjects ) {

			if ( callbacks.has( renderObject.object ) && renderObject.getMaterialBindings() !== null ) this.calledBack.add( renderObject.getMaterialBindings() );

		}

		this.representatives.length = 0;

		for ( const renderObject of renderObjects ) {

			const materialBindings = renderObject.getMaterialBindings();

			if ( materialBindings === null ) this.representatives.push( renderObject );
			else if ( sharedBindings.has( materialBindings ) === false ) {

				sharedBindings.add( materialBindings );
				this.representatives.push( renderObject );

			}

		}

		this.geometryUploads.clear();
		this.geometryUploads.rememberRenderObjects( renderer, renderObjects );
		this.viewRefresh.reset( this.representatives );

	}

	_uploadChangedBuffers( renderer ) {

		if ( this.geometryUploads.upload( renderer ) ) this.reencode = true;

	}

	_refreshRepresentatives( renderer ) {

		this.viewRefresh.refresh( renderer, this.refreshSteps( renderer ) );

	}

	refreshSteps( renderer ) {

		if ( this._refreshSteps !== undefined && this._refreshSteps.renderer === renderer ) return this._refreshSteps;

		this._refreshSteps = {
			renderer,
			full: ( renderObject ) => refreshFully( renderer, renderObject ),
			shared: ( renderObject, sources ) => refreshShared( renderer, renderObject, sources ),
			sources: ( renderObject ) => this._steadySourcesOf( renderObject )
		};

		return this._refreshSteps;

	}

	_steadySourcesOf( renderObject ) {

		const materialBindings = renderObject.getMaterialBindings();

		if ( materialBindings === null || this.calledBack.has( materialBindings ) ) return null;

		const sources = new SteadyUniformSources( renderObject );

		return sources.steady ? sources : null;

	}

	_bindGroupsChanged( renderer, chunk ) {

		const backend = renderer.backend;

		for ( const [ bindGroup, group ] of chunk.bindGroups ) if ( backend.get( bindGroup ).group !== group ) return true;

		return false;

	}

}

export default RetainedScenePass;

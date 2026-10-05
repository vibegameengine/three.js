import { Object3D } from '../../core/Object3D.js';

// A view of original scene primitives. It never reparents or copies meshes.
// Selection/visibility is evaluated before draw preparation; GPU commands survive
// transform and skeleton changes, while draw-layout changes invalidate them.
class RenderObjectPass {

	constructor( filter ) {

		this.filter = filter;
		this.version = 0;
		this.states = new WeakMap();

	}

	invalidate() {

		this.version ++;

	}

	prepare( renderList, scene, context, renderer ) {

		if ( renderList.bundles.length || context.occlusionQueryCount ) throw new Error( 'RenderObjectPass requires a flat draw list without occlusion queries.' );

		let state = this.states.get( context );
		if ( state === undefined ) {

			state = { version: 0, values: [], bundleGroup: { version: 0, static: true }, camera: renderList.camera, renderList };
			this.states.set( context, state );

		}

		let at = 0;
		let changed = false;
		const value = ( next ) => {

			if ( state.values[ at ] !== next ) {

				state.values[ at ] = next;
				changed = true;

			}
			at ++;

		};

		value( this.version );
		value( scene.overrideMaterial );
		value( scene.overrideMaterial?.version );
		value( renderer.contextNode );
		value( renderer.contextNode.version );
		value( renderer.opaque );
		value( renderer.transparent );
		for ( const list of [ renderList.opaque, renderList.transparentDoublePass, renderList.transparent ] ) {

			value( list.length );
			for ( const item of list ) {

				const { object, geometry, material, group, clippingContext } = item;
				// Callbacks and batched draw lists may change commands on every call.
				if ( object.onBeforeRender !== Object3D.prototype.onBeforeRender || object.onAfterRender !== Object3D.prototype.onAfterRender || object.isBatchedMesh ) changed = true;
				value( object );
				value( geometry );
				value( material );
				value( material.version );
				value( material.side );
				value( material.transparent );
				value( material.alphaTest );
				value( material.alphaMap );
				value( material.positionNode );
				value( clippingContext?.cacheKey );
				value( geometry.drawRange.start );
				value( geometry.drawRange.count );
				value( group?.start );
				value( group?.count );
				value( object.count );
				value( geometry.instanceCount );
				value( object.skeleton );
				value( object.skeleton?.boneTexture );
				value( geometry.index );
				value( geometry.index?.version );
				for ( const name in geometry.attributes ) {

					const attribute = geometry.attributes[ name ];
					value( name );
					value( attribute );
					value( attribute.data?.version ?? attribute.version );

				}
				value( object.instanceMatrix );
				value( object.instanceMatrix?.version );

			}

		}
		if ( state.values.length !== at ) {

			state.values.length = at;
			changed = true;

		}
		if ( changed ) state.bundleGroup.version ++;
		state.renderList = renderList;
		return state;

	}

	dispose() {

		this.states = new WeakMap();

	}

}

export default RenderObjectPass;

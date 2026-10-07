import { DoubleSide, FrontSide } from '../../constants.js';
import { Vector4 } from '../../math/Vector4.js';

const _depth = /*@__PURE__*/ new Vector4();
const NO_DRAWS = Object.freeze( [] );

function drawOrder( a, b ) {

	return ( a.groupOrder - b.groupOrder ) || ( a.renderOrder - b.renderOrder ) || ( b.z - a.z ) || ( a.id - b.id );

}

export function transparentDrawSequence( visible ) {

	const sorted = [ ...visible ].sort( drawOrder );
	const backs = sorted.filter( ( entry ) => entry.doublePass ).map( ( entry ) => ( { entry, side: 'back' } ) );

	return [ ...backs, ...sorted.map( ( entry ) => ( { entry, side: 'front' } ) ) ];

}

function needsDoublePass( material ) {

	const hasTransmission = material.transmission > 0 || ( material.transmissionNode && material.transmissionNode.isNode );

	return hasTransmission && material.side === DoubleSide && material.forceSinglePass === false;

}

class RetainedTransparents {

	constructor() {

		this.entries = [];
		this.visible = [];

	}

	rebuild( items ) {

		this.entries = items.map( ( item ) => ( {
			item,
			groupOrder: item.groupOrder,
			renderOrder: item.object.renderOrder,
			id: item.object.id,
			z: 0,
			doublePass: needsDoublePass( item.material ),
			front: this._side( 'front' ),
			back: this._side( 'back' )
		} ) );

	}

	_side( side ) {

		return { side, bundleGroup: { version: 0, static: true }, renderBundle: undefined, renderObjects: NO_DRAWS, bindGroups: new Map(), encodedFor: null };

	}

	draw( renderer, frame ) {

		const { renderContext, camera, frustum, projScreenMatrix } = frame;
		this.visible.length = 0;

		for ( const entry of this.entries ) {

			if ( entry.item.hidden === true ) continue;
			const { object, geometry } = entry.item;
			const inside = object.frustumCulled === false || ( object.isSprite === true ? frustum.intersectsSprite( object, camera ) : frustum.intersectsObject( object, camera ) );
			if ( inside === false ) continue;

			if ( geometry.boundingSphere === null ) geometry.computeBoundingSphere();
			entry.z = _depth.copy( geometry.boundingSphere.center ).applyMatrix4( object.matrixWorld ).applyMatrix4( projScreenMatrix ).z;
			this.visible.push( entry );

		}

		for ( const { entry, side } of transparentDrawSequence( this.visible ) ) this._drawSide( renderer, frame, entry, entry[ side ] );

	}

	_drawSide( renderer, frame, entry, draw ) {

		if ( this._needsEncode( renderer, frame, draw ) ) {

			this._encode( renderer, frame, entry, draw );
			return;

		}

		this._refresh( renderer, draw );

		if ( this._bindGroupsChanged( renderer, draw ) ) {

			this._encode( renderer, frame, entry, draw );
			return;

		}

		renderer.backend.drawBundle( frame.renderContext, draw.renderBundle );

	}

	_needsEncode( renderer, frame, draw ) {

		if ( draw.renderBundle === undefined || draw.encodedFor !== frame.encodeKey ) return true;

		return renderer.backend.get( draw.renderBundle ).version !== draw.bundleGroup.version;

	}

	_encode( renderer, frame, entry, draw ) {

		const { item } = entry;
		const material = item.material;
		const renderList = draw.side === 'back'
			? { opaque: NO_DRAWS, transparent: NO_DRAWS, transparentDoublePass: [ item ] }
			: { opaque: NO_DRAWS, transparent: [ item ], transparentDoublePass: NO_DRAWS };

		draw.bundleGroup.version ++;

		if ( draw.side === 'front' && entry.doublePass ) material.side = FrontSide;
		renderer._renderBundle( { bundleGroup: draw.bundleGroup, camera: frame.camera, renderList }, frame.sceneRef, frame.lightsNode, true );
		if ( draw.side === 'front' && entry.doublePass ) material.side = DoubleSide;

		draw.renderBundle = renderer._bundles.get( draw.bundleGroup, frame.camera );
		draw.renderObjects = renderer.backend.get( draw.renderBundle ).renderObjects;
		draw.encodedFor = frame.encodeKey;
		draw.bindGroups.clear();
		for ( const renderObject of draw.renderObjects ) for ( const bindGroup of renderObject.getBindings() ) draw.bindGroups.set( bindGroup, renderer.backend.get( bindGroup ).group );

	}

	_refresh( renderer, draw ) {

		const nodes = renderer._nodes;

		for ( const renderObject of draw.renderObjects ) {

			if ( nodes.needsRefresh( renderObject ) && renderer._refreshedWithMaterial( renderObject ) === false ) {

				nodes.updateBefore( renderObject );
				nodes.updateForRender( renderObject );
				renderer._bindings.updateForRender( renderObject );
				nodes.updateAfter( renderObject );

			}

		}

	}

	_bindGroupsChanged( renderer, draw ) {

		for ( const [ bindGroup, group ] of draw.bindGroups ) if ( renderer.backend.get( bindGroup ).group !== group ) return true;

		return false;

	}

}

export default RetainedTransparents;

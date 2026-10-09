import { Object3D } from '../../core/Object3D.js';
import { materialsRevision, visibilityChangesSince } from '../../core/DrawListRevision.js';
import { levelGeometries, screenSizeBand } from './ScreenSizeLods.js';

function retainedDrawOrder( a, b ) {

	return ( a.groupOrder - b.groupOrder ) || ( a.object.renderOrder - b.object.renderOrder ) || ( a.material.id - b.material.id ) || ( a.geometry.id - b.geometry.id );

}

function shownInWorld( object ) {

	for ( let node = object; node !== null; node = node.parent ) if ( node.visible === false ) return false;

	return true;

}

class RetainedDrawList {

	constructor() {

		this.items = [];
		this.transparent = [];
		this.direct = [];
		this.lights = [];
		this.lods = [];
		this.callbacks = [];
		this.materials = new Map();
		this.drawsOf = new Map();
		this.visibilitySeen = - 1;
		this.scene = null;
		this.rasterBins = null;
		this.binned = false;
		this.sceneRevision = - 1;
		this.cameraMask = - 1;
		this.materialsRevision = - 1;
		this.version = 0;

	}

	isCurrent( scene, camera, rasterBins = null ) {

		if ( this.scene !== scene || this.rasterBins !== rasterBins || this.sceneRevision !== scene.drawListRevision || this.cameraMask !== camera.layers.mask ) return false;

		if ( this.materialsRevision === materialsRevision() ) return true;

		for ( const [ material, version ] of this.materials ) {

			if ( material.version !== version ) return false;

		}

		this.materialsRevision = materialsRevision();

		return true;

	}

	build( scene, camera, rasterBins = null ) {

		this.items.length = 0;
		this.transparent.length = 0;
		this.direct.length = 0;
		this.lights.length = 0;
		this.lods.length = 0;
		this.callbacks.length = 0;
		this.materials.clear();
		this.drawsOf.clear();

		this.binned = rasterBins !== null;
		this._collect( scene, camera, 0, true );
		if ( rasterBins !== null ) this._collect( rasterBins, camera, 0, true );
		this.items.sort( retainedDrawOrder );

		this.scene = scene;
		this.rasterBins = rasterBins;
		this.sceneRevision = scene.drawListRevision;
		this.cameraMask = camera.layers.mask;
		this.materialsRevision = materialsRevision();
		this.visibilitySeen = scene.visibilityRevision;
		this.version ++;

	}

	applyVisibility( scene ) {

		const changed = visibilityChangesSince( scene, this.visibilitySeen );
		this.visibilitySeen = scene.visibilityRevision;
		const updated = [];

		if ( changed === null ) {

			for ( const [ object, draws ] of this.drawsOf ) this._refreshHidden( object, draws, updated );
			return updated;

		}

		const visited = new Set();

		for ( const object of changed ) {

			if ( visited.has( object ) ) continue;
			visited.add( object );
			object.traverse( ( descendant ) => {

				const draws = this.drawsOf.get( descendant );
				if ( draws !== undefined ) this._refreshHidden( descendant, draws, updated );

			} );

		}

		return updated;

	}

	_refreshHidden( object, draws, updated ) {

		const hidden = shownInWorld( object ) === false;

		for ( const draw of draws ) {

			if ( draw.hidden === hidden ) continue;
			draw.hidden = hidden;
			updated.push( draw );

		}

	}

	_remember( object, draw, list ) {

		list.push( draw );
		const draws = this.drawsOf.get( object );
		if ( draws === undefined ) this.drawsOf.set( object, [ draw ] );
		else draws.push( draw );

	}

	_collect( object, camera, groupOrder, shown ) {

		shown = shown && object.visible;

		if ( object.isBundleGroup === true ) throw new Error( 'RetainedDrawList: a BundleGroup inside a retained scene is not supported; render it in its own pass.' );
		if ( object.isClippingGroup === true ) throw new Error( 'RetainedDrawList: a ClippingGroup inside a retained scene is not supported.' );

		if ( object.layers.test( camera.layers ) ) {

			if ( object.isGroup === true ) groupOrder = object.renderOrder;
			else if ( object.isLOD === true ) this.lods.push( object );
			else if ( object.isLight === true ) this.lights.push( object );
			else if ( object.isMesh === true || object.isLine === true || object.isPoints === true || object.isSprite === true ) this._collectDrawable( object, groupOrder, shown );

		}

		const children = object.children;

		for ( let i = 0, l = children.length; i < l; i ++ ) this._collect( children[ i ], camera, groupOrder, shown );

	}

	_collectDrawable( object, groupOrder, shown ) {

		if ( this.binned === true && object.drawnByRasterBins === true ) return;

		if ( object.onBeforeRender !== Object3D.prototype.onBeforeRender || object.onAfterRender !== Object3D.prototype.onAfterRender ) this.callbacks.push( object );

		const levels = levelGeometries( object );

		if ( levels === null ) {

			this._collectGeometry( object, object.geometry, null, groupOrder, shown );
			return;

		}

		const { screenSizes } = object.screenSizeLods;

		levels.forEach( ( geometry, level ) => this._collectGeometry( object, geometry, screenSizeBand( screenSizes, level ), groupOrder, shown ) );

	}

	_collectGeometry( object, geometry, band, groupOrder, shown ) {

		const material = object.material;

		if ( Array.isArray( material ) ) {

			for ( const group of geometry.groups ) {

				const groupMaterial = material[ group.materialIndex ];
				if ( groupMaterial && groupMaterial.visible ) this._push( object, { geometry, material: groupMaterial, group, band }, groupOrder, shown );

			}

		} else if ( material.visible ) {

			this._push( object, { geometry, material, group: null, band }, groupOrder, shown );

		}

	}

	_push( object, { geometry, material, group, band }, groupOrder, shown ) {

		this.materials.set( material, material.version );

		const item = { object, geometry, material, group, band, groupOrder, hidden: ! shown };

		if ( material.transparent === true || material.transmission > 0 ) this._remember( object, item, this.transparent );
		else if ( this._drawsEveryFrame( object ) ) this._remember( object, item, this.direct );
		else this._remember( object, item, this.items );

	}

	_drawsEveryFrame( object ) {

		if ( object.occlusionTest === true || object.isBatchedMesh === true ) return true;

		return object.isInstancedMesh === true && ( object.instanceCulling === undefined || object.instanceCulling === null );

	}

}

export default RetainedDrawList;

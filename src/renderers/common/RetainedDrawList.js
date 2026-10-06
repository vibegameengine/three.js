import { Object3D } from '../../core/Object3D.js';
import { materialsRevision } from '../../core/DrawListRevision.js';

function retainedDrawOrder( a, b ) {

	return ( a.groupOrder - b.groupOrder ) || ( a.object.renderOrder - b.object.renderOrder ) || ( a.material.id - b.material.id ) || ( a.geometry.id - b.geometry.id );

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
		this.scene = null;
		this.sceneRevision = - 1;
		this.cameraMask = - 1;
		this.materialsRevision = - 1;
		this.version = 0;

	}

	isCurrent( scene, camera ) {

		if ( this.scene !== scene || this.sceneRevision !== scene.drawListRevision || this.cameraMask !== camera.layers.mask ) return false;

		if ( this.materialsRevision === materialsRevision() ) return true;

		for ( const [ material, version ] of this.materials ) {

			if ( material.version !== version ) return false;

		}

		this.materialsRevision = materialsRevision();

		return true;

	}

	build( scene, camera ) {

		this.items.length = 0;
		this.transparent.length = 0;
		this.direct.length = 0;
		this.lights.length = 0;
		this.lods.length = 0;
		this.callbacks.length = 0;
		this.materials.clear();

		this._collect( scene, camera, 0 );
		this.items.sort( retainedDrawOrder );

		this.scene = scene;
		this.sceneRevision = scene.drawListRevision;
		this.cameraMask = camera.layers.mask;
		this.materialsRevision = materialsRevision();
		this.version ++;

	}

	_collect( object, camera, groupOrder ) {

		if ( object.visible === false ) return;

		if ( object.isBundleGroup === true ) throw new Error( 'RetainedDrawList: a BundleGroup inside a retained scene is not supported; render it in its own pass.' );
		if ( object.isClippingGroup === true ) throw new Error( 'RetainedDrawList: a ClippingGroup inside a retained scene is not supported.' );

		if ( object.layers.test( camera.layers ) ) {

			if ( object.isGroup === true ) groupOrder = object.renderOrder;
			else if ( object.isLOD === true ) this.lods.push( object );
			else if ( object.isLight === true ) this.lights.push( object );
			else if ( object.isMesh === true || object.isLine === true || object.isPoints === true || object.isSprite === true ) this._collectDrawable( object, groupOrder );

		}

		const children = object.children;

		for ( let i = 0, l = children.length; i < l; i ++ ) this._collect( children[ i ], camera, groupOrder );

	}

	_collectDrawable( object, groupOrder ) {

		const { geometry, material } = object;

		if ( object.onBeforeRender !== Object3D.prototype.onBeforeRender || object.onAfterRender !== Object3D.prototype.onAfterRender ) this.callbacks.push( object );

		if ( Array.isArray( material ) ) {

			for ( const group of geometry.groups ) {

				const groupMaterial = material[ group.materialIndex ];
				if ( groupMaterial && groupMaterial.visible ) this._push( object, geometry, groupMaterial, group, groupOrder );

			}

		} else if ( material.visible ) {

			this._push( object, geometry, material, null, groupOrder );

		}

	}

	_push( object, geometry, material, group, groupOrder ) {

		this.materials.set( material, material.version );

		const item = { object, geometry, material, group, groupOrder };

		if ( material.transparent === true || material.transmission > 0 ) this.transparent.push( item );
		else if ( this._drawsEveryFrame( object ) ) this.direct.push( item );
		else this.items.push( item );

	}

	_drawsEveryFrame( object ) {

		if ( object.occlusionTest === true || object.isBatchedMesh === true ) return true;

		return object.isInstancedMesh === true && ( object.instanceCulling === undefined || object.instanceCulling === null );

	}

}

export default RetainedDrawList;

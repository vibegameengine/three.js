import { Sphere } from '../../math/Sphere.js';
import { Vector3 } from '../../math/Vector3.js';

export const NO_UPPER_SCREEN_SIZE = 1e30;
export const NEAREST_DISTANCE_METRES = 0.01;
export const FULL_SCREEN_SIZE_BAND = Object.freeze( { min: 0, max: NO_UPPER_SCREEN_SIZE } );

export function screenMultiple( projectionMatrix ) {

	const projection = projectionMatrix.elements;

	return Math.max( 0.5 * projection[ 0 ], 0.5 * projection[ 5 ] );

}

export function projectedScreenSize( camera, radius, distance ) {

	return ( 2 * screenMultiple( camera.projectionMatrix ) * radius ) / Math.max( NEAREST_DISTANCE_METRES, distance );

}

const _bounds = /*@__PURE__*/ new Sphere();
const _eye = /*@__PURE__*/ new Vector3();

export function drawnAtThisSize( { object, band }, camera ) {

	if ( band === null || band === undefined ) return true;

	const geometry = object.geometry;
	if ( geometry.boundingSphere === null ) geometry.computeBoundingSphere();
	_bounds.copy( geometry.boundingSphere ).applyMatrix4( object.matrixWorld );
	const size = projectedScreenSize( camera, _bounds.radius, _eye.setFromMatrixPosition( camera.matrixWorld ).distanceTo( _bounds.center ) );

	return size >= band.min && size < band.max;

}

export function levelGeometryFor( object, camera ) {

	const lods = object.screenSizeLods;

	if ( lods === undefined ) return object.geometry;

	const geometry = object.geometry;
	if ( geometry.boundingSphere === null ) geometry.computeBoundingSphere();
	_bounds.copy( geometry.boundingSphere ).applyMatrix4( object.matrixWorld );
	const level = lodForScreenSize( lods.screenSizes, projectedScreenSize( camera, _bounds.radius, _eye.setFromMatrixPosition( camera.matrixWorld ).distanceTo( _bounds.center ) ) );

	return level === 0 ? geometry : lods.geometries[ level - 1 ];

}

export function lodForScreenSize( screenSizes, screenSize ) {

	for ( let lod = screenSizes.length - 1; lod >= 0; lod -- ) if ( screenSizes[ lod ] > screenSize ) return lod;

	return 0;

}

export function screenSizeBand( screenSizes, level ) {

	const coarsest = screenSizes.length - 1;

	return {
		min: level === coarsest ? 0 : screenSizes[ level + 1 ],
		max: level === 0 ? NO_UPPER_SCREEN_SIZE : screenSizes[ level ]
	};

}

export function levelGeometries( mesh ) {

	const lods = mesh.screenSizeLods;

	return lods === undefined ? null : [ mesh.geometry, ...lods.geometries ];

}

export function drawSlotKey( { group, geometry } ) {

	return group !== null && group !== undefined ? group : geometry;

}

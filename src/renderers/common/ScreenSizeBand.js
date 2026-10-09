import { max, uniform } from '../../nodes/TSL.js';
import { Vector4 } from '../../math/Vector4.js';
import { NEAREST_DISTANCE_METRES, screenMultiple } from './ScreenSizeLods.js';

export function lodEyeUniform() {

	return uniform( new Vector4() );

}

export function aimLodEye( eye, camera ) {

	const position = camera.matrixWorld.elements;
	eye.value.set( position[ 12 ], position[ 13 ], position[ 14 ], screenMultiple( camera.projectionMatrix ) );

}

export function insideScreenSizeBand( { worldCenter, worldRadius, band, eye } ) {

	const distance = max( worldCenter.sub( eye.xyz ).length(), NEAREST_DISTANCE_METRES );
	const screenSize = eye.w.mul( 2 ).mul( worldRadius ).div( distance ).toVar();

	return screenSize.greaterThanEqual( band.x ).and( screenSize.lessThan( band.y ) );

}

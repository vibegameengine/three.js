export function instanceCullingFor( object, camera ) {

	const culling = object.instanceCulling;

	if ( culling === undefined || culling === null || camera === null || camera === undefined ) return null;

	return culling.camera === camera ? culling : null;

}

export function instanceCullingOf( renderObject ) {

	return instanceCullingFor( renderObject.object, renderObject.camera );

}

export function instanceCullingFor( object, camera, context = null ) {

	const culling = object.instanceCulling;

	if ( culling === undefined || culling === null || camera === null || camera === undefined ) return null;

	if ( culling.camera !== camera ) return null;

	return culling.context === undefined || culling.context === context ? culling : null;

}

export function instanceCullingOf( renderObject ) {

	return instanceCullingFor( renderObject.object, renderObject.camera, renderObject.context );

}

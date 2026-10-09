const moved = [];

export function notePrimitiveMoved( object ) {

	if ( object._primitiveMoveQueued === true ) return;
	object._primitiveMoveQueued = true;
	moved.push( object );

}

export function takeMovedPrimitives( into ) {

	for ( let i = 0, l = moved.length; i < l; i ++ ) {

		const object = moved[ i ];
		object._primitiveMoveQueued = false;
		into.push( object );

	}

	moved.length = 0;
	return into;

}

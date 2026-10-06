const revisions = { materials: 0 };
const dirtyBuffers = new Set();
let bufferListeners = 0;

export function drawListRoot( object ) {

	while ( object.parent !== null ) object = object.parent;

	return object;

}

export function touchDrawList( object ) {

	drawListRoot( object ).drawListRevision ++;

}

export function touchMaterials() {

	revisions.materials ++;

}

export function materialsRevision() {

	return revisions.materials;

}

export function markBufferDirty( buffer ) {

	if ( bufferListeners > 0 ) dirtyBuffers.add( buffer );

}

export function listenForDirtyBuffers() {

	bufferListeners ++;

	return () => {

		bufferListeners --;
		if ( bufferListeners === 0 ) dirtyBuffers.clear();

	};

}

export function takeDirtyBuffers( into ) {

	for ( const buffer of dirtyBuffers ) into.push( buffer );
	dirtyBuffers.clear();

	return into;

}

export function defineDrawableAccessors( prototype ) {

	for ( const key of [ 'geometry', 'material' ] ) {

		const field = '_' + key;

		Object.defineProperty( prototype, key, {
			configurable: true,
			enumerable: true,
			get() {

				return this[ field ];

			},
			set( value ) {

				if ( this[ field ] === value ) return;
				this[ field ] = value;
				touchDrawList( this );

			}
		} );

	}

}

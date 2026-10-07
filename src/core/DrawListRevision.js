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

const VISIBILITY_JOURNAL_LIMIT = 8192;

export function touchVisibility( object ) {

	const root = drawListRoot( object );
	root.visibilityRevision ++;
	const journal = root.visibilityJournal ?? ( root.visibilityJournal = { first: root.visibilityRevision, objects: [] } );
	journal.objects.push( object );

	if ( journal.objects.length > VISIBILITY_JOURNAL_LIMIT ) {

		const dropped = journal.objects.length - VISIBILITY_JOURNAL_LIMIT / 2;
		journal.objects.splice( 0, dropped );
		journal.first += dropped;

	}

}

export function visibilityChangesSince( root, seenRevision ) {

	if ( seenRevision === root.visibilityRevision ) return [];

	const journal = root.visibilityJournal;
	if ( journal === undefined || seenRevision + 1 < journal.first ) return null;

	return journal.objects.slice( seenRevision + 1 - journal.first );

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

import { ChangeJournal } from './ChangeJournal.js';

const revisions = { materials: 0 };

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
	const journal = root.visibilityJournal ?? ( root.visibilityJournal = new ChangeJournal( VISIBILITY_JOURNAL_LIMIT, root.visibilityRevision ) );
	journal.note( object );
	root.visibilityRevision = journal.revision;

}

export function visibilityChangesSince( root, seenRevision ) {

	if ( seenRevision === root.visibilityRevision ) return [];
	if ( root.visibilityJournal === undefined ) return null;

	return root.visibilityJournal.since( seenRevision );

}

export function touchMaterials() {

	revisions.materials ++;

}

export function materialsRevision() {

	return revisions.materials;

}

const dirtyBufferSets = new Set();

export function markBufferDirty( buffer ) {

	for ( const dirty of dirtyBufferSets ) dirty.add( buffer );

}

export function dirtyBufferListener() {

	const dirty = new Set();
	dirtyBufferSets.add( dirty );

	return {

		take( into ) {

			for ( const buffer of dirty ) into.push( buffer );
			dirty.clear();

			return into;

		},

		stop() {

			dirtyBufferSets.delete( dirty );
			dirty.clear();

		}

	};

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

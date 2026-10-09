import { ChangeJournal } from './ChangeJournal.js';

const TRANSFORM_JOURNAL_LIMIT = 1 << 16;
const journal = new ChangeJournal( TRANSFORM_JOURNAL_LIMIT );

export function noteTransformChanged( object ) {

	journal.note( object );

}

export function transformRevision() {

	return journal.revision;

}

export function transformChangesSince( seenRevision ) {

	return journal.since( seenRevision );

}

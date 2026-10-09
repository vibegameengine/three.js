const NOTHING_CHANGED = Object.freeze( [] );

export class ChangeJournal {

	constructor( limit, revision = 0 ) {

		this.limit = limit;
		this.revision = revision;
		this.first = revision + 1;
		this.entries = [];

	}

	note( entry ) {

		this.revision ++;
		this.entries.push( entry );

		if ( this.entries.length > this.limit ) {

			const dropped = this.entries.length - ( this.limit >> 1 );
			this.entries.splice( 0, dropped );
			this.first += dropped;

		}

	}

	since( seenRevision ) {

		if ( seenRevision === this.revision ) return NOTHING_CHANGED;
		if ( seenRevision + 1 < this.first ) return null;

		return this.entries.slice( seenRevision + 1 - this.first );

	}

}

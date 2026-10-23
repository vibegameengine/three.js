function sameDraw( entry, item ) {

	return entry.geometry === item.geometry && entry.material === item.material && entry.group === item.group && entry.band === item.band;

}

/**
 * Gives every draw of a retained pass a slot that it keeps for as long as it stays in the scene,
 * as a GPU scene keeps the id of a primitive: the culling arrays and the indirect arguments are
 * addressed by slot, so a draw that joins or leaves touches its own slot and no other draw moves.
 *
 * @private
 */
class RetainedSlots {

	constructor() {

		this.byObject = new Map();
		this.free = [];
		this.capacity = 0;

	}

	assign( items ) {

		const kept = new Map();
		const added = [];

		for ( const item of items ) {

			const known = this.byObject.get( item.object );
			const index = known === undefined ? - 1 : known.findIndex( ( entry ) => sameDraw( entry, item ) );
			let entry;

			if ( index >= 0 ) entry = known.splice( index, 1 )[ 0 ];
			else {

				entry = { geometry: item.geometry, material: item.material, group: item.group, band: item.band, slot: this.free.length > 0 ? this.free.pop() : this.capacity ++ };
				added.push( entry.slot );

			}

			item.slot = entry.slot;
			const list = kept.get( item.object );
			if ( list === undefined ) kept.set( item.object, [ entry ] );
			else list.push( entry );

		}

		const removed = [];

		for ( const entries of this.byObject.values() ) for ( const entry of entries ) removed.push( entry.slot );

		this.free.push( ...removed );
		this.byObject = kept;

		return { added, removed };

	}

}

export default RetainedSlots;

export const CHUNK_DRAWS = 64;

function orderKeyOf( item ) {

	return `${ item.groupOrder }|${ item.object.renderOrder }`;

}

function signatureOf( items ) {

	return items.map( ( item ) => item.slot ).join( ',' );

}

/**
 * Cuts the draws of a retained pass into bundles that each hold whole materials, and keeps a
 * material in the bundle it was first put in. A draw that joins or leaves the scene changes the
 * bundle of its own material, which is the only one recorded again; mesh draw commands are cached
 * per primitive in the same spirit, so adding a primitive never rebuilds the commands of the rest.
 *
 * @private
 */
class RetainedChunks {

	constructor() {

		this.chunkOf = new Map();
		this.open = new Map();
		this.chunks = [];
		this.nextId = 0;

	}

	assign( items, order ) {

		const members = new Map();

		for ( const item of items ) {

			const key = orderKeyOf( item );
			let byMaterial = this.chunkOf.get( key );
			if ( byMaterial === undefined ) this.chunkOf.set( key, byMaterial = new Map() );
			let chunk = byMaterial.get( item.material );

			if ( chunk === undefined ) {

				chunk = this._chunkForNewMaterial( key, item, members );
				byMaterial.set( item.material, chunk );

			}

			let list = members.get( chunk );
			if ( list === undefined ) members.set( chunk, list = [] );
			list.push( item );

		}

		this._forgetAbsent( members );

		for ( const [ chunk, list ] of members ) {

			chunk.items = list.sort( order );
			const signature = signatureOf( chunk.items );
			if ( signature !== chunk.signature ) chunk.dirty = true;
			chunk.signature = signature;

		}

		this.chunks = [ ...members.keys() ].sort( ( a, b ) => ( a.groupOrder - b.groupOrder ) || ( a.renderOrder - b.renderOrder ) || ( a.id - b.id ) );

		return this.chunks;

	}

	markAllDirty() {

		for ( const chunk of this.chunks ) chunk.dirty = true;

	}

	_chunkForNewMaterial( key, item, members ) {

		const open = this.open.get( key );

		if ( open !== undefined && ( members.get( open )?.length ?? 0 ) < CHUNK_DRAWS ) return open;

		const chunk = { id: this.nextId ++, groupOrder: item.groupOrder, renderOrder: item.object.renderOrder, bundleGroup: { version: 0, static: true }, items: [], signature: null, dirty: true, renderBundle: undefined, renderObjects: [], bindGroups: new Map() };
		this.open.set( key, chunk );
		return chunk;

	}

	_forgetAbsent( members ) {

		for ( const [ key, byMaterial ] of this.chunkOf ) {

			for ( const [ material, chunk ] of byMaterial ) if ( members.has( chunk ) === false || members.get( chunk ).every( ( item ) => item.material !== material ) ) byMaterial.delete( material );

			if ( byMaterial.size === 0 ) this.chunkOf.delete( key );

		}

		for ( const [ key, chunk ] of this.open ) {

			if ( members.has( chunk ) ) continue;
			const remaining = this.chunks.filter( ( other ) => other !== chunk && members.has( other ) && `${ other.groupOrder }|${ other.renderOrder }` === key );
			if ( remaining.length > 0 ) this.open.set( key, remaining[ remaining.length - 1 ] );
			else this.open.delete( key );

		}

	}

}

export default RetainedChunks;

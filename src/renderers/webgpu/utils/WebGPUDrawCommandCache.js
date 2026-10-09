const PIPELINE = 1;
const BIND_GROUP = 2;
const INDEX_BUFFER = 3;
const VERTEX_BUFFER = 4;
const DRAW = 5;
const DRAW_INDEXED = 6;
const DRAW_INDIRECT = 7;
const DRAW_INDEXED_INDIRECT = 8;

class DrawCommand {

	constructor() {

		this.values = [];
		this.length = 0;

	}

	begin( pipeline ) {

		this.length = 0;
		this.push( PIPELINE, pipeline );

	}

	bindGroup( index, group ) {

		this.push( BIND_GROUP, index );
		this.values[ this.length ++ ] = group;

	}

	indexBuffer( buffer, format ) {

		this.push( INDEX_BUFFER, buffer );
		this.values[ this.length ++ ] = format;

	}

	vertexBuffer( buffer ) {

		this.push( VERTEX_BUFFER, buffer );

	}

	draw( vertexCount, instanceCount, firstVertex ) {

		this.push( DRAW, vertexCount );
		this.values[ this.length ++ ] = instanceCount;
		this.values[ this.length ++ ] = firstVertex;

	}

	drawIndexed( indexCount, instanceCount, firstIndex ) {

		this.push( DRAW_INDEXED, indexCount );
		this.values[ this.length ++ ] = instanceCount;
		this.values[ this.length ++ ] = firstIndex;

	}

	drawIndirect( buffer, offsets ) {

		this.push( DRAW_INDIRECT, buffer );
		for ( let i = 0; i < offsets.length; i ++ ) this.values[ this.length ++ ] = offsets[ i ];

	}

	drawIndexedIndirect( buffer, offsets ) {

		this.push( DRAW_INDEXED_INDIRECT, buffer );
		for ( let i = 0; i < offsets.length; i ++ ) this.values[ this.length ++ ] = offsets[ i ];

	}

	push( tag, value ) {

		this.values[ this.length ++ ] = tag;
		this.values[ this.length ++ ] = value;

	}

}

class DrawCommandCache {

	constructor() {

		this.recorded = [];
		this.bundle = null;

	}

	replay( command ) {

		if ( this.bundle === null || this.recorded.length !== command.length ) return null;

		const recorded = this.recorded;
		const values = command.values;

		for ( let i = 0, l = command.length; i < l; i ++ ) {

			if ( recorded[ i ] !== values[ i ] ) return null;

		}

		return this.bundle;

	}

	remember( command, bundle ) {

		this.recorded = command.values.slice( 0, command.length );
		this.bundle = bundle;

	}

}

export { DrawCommand, DrawCommandCache };

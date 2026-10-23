import { DynamicDrawUsage } from '../../constants.js';
import { dirtyBufferListener } from '../../core/DrawListRevision.js';
import { AttributeType } from './Constants.js';

function bufferOf( attribute ) {

	return attribute.isInterleavedBufferAttribute ? attribute.data : attribute;

}

function typeOf( attribute ) {

	return attribute.isStorageBufferAttribute || attribute.isStorageInstancedBufferAttribute ? AttributeType.STORAGE : AttributeType.VERTEX;

}

class RetainedUploads {

	constructor() {

		this.byBuffer = new Map();
		this.dynamic = [];
		this.gpuBuffers = new Map();
		this.dirty = dirtyBufferListener();
		this.taken = [];

	}

	clear() {

		this.byBuffer.clear();
		this.dynamic.length = 0;
		this.gpuBuffers.clear();

	}

	rememberRenderObjects( renderer, renderObjects ) {

		for ( const renderObject of renderObjects ) {

			for ( const attribute of renderObject.getAttributes() ) this.remember( renderer, attribute, typeOf( attribute ) );

			const index = renderer._geometries.getIndex( renderObject );
			if ( index !== null ) this.remember( renderer, index, AttributeType.INDEX );

		}

	}

	remember( renderer, attribute, type ) {

		const buffer = bufferOf( attribute );
		let uploads = this.byBuffer.get( buffer );

		if ( uploads === undefined ) {

			uploads = [];
			this.byBuffer.set( buffer, uploads );

		}

		if ( uploads.some( ( upload ) => upload.attribute === attribute ) ) return;

		const upload = { attribute, type };
		uploads.push( upload );
		if ( buffer.usage === DynamicDrawUsage ) this.dynamic.push( upload );
		this.gpuBuffers.set( attribute, renderer.backend.get( attribute ).buffer );

	}

	upload( renderer ) {

		let replaced = false;
		const dirty = this.dirty.take( this.taken );

		for ( const buffer of dirty ) {

			const uploads = this.byBuffer.get( buffer );
			if ( uploads !== undefined ) for ( const upload of uploads ) replaced = this._upload( renderer, upload ) || replaced;

		}

		dirty.length = 0;

		for ( const upload of this.dynamic ) replaced = this._upload( renderer, upload ) || replaced;

		return replaced;

	}

	dispose() {

		this.dirty.stop();
		this.clear();

	}

	_upload( renderer, { attribute, type } ) {

		renderer._attributes.update( attribute, type );

		const buffer = renderer.backend.get( attribute ).buffer;
		if ( buffer === this.gpuBuffers.get( attribute ) ) return false;

		this.gpuBuffers.set( attribute, buffer );

		return true;

	}

}

export default RetainedUploads;

import Buffer from './Buffer.js';
import { getFloatLength } from './BufferUtils.js';

/**
 * Represents a storage buffer binding type.
 *
 * @private
 * @augments Buffer
 */
class StorageBuffer extends Buffer {

	/**
	 * Constructs a new uniform buffer.
	 *
	 * @param {string} name - The buffer's name.
	 * @param {BufferAttribute} attribute - The buffer attribute.
	 */
	constructor( name, attribute ) {

		super( name, null );

		/**
		 * This flag can be used for type testing.
		 *
		 * @type {BufferAttribute}
		 */
		this.attribute = attribute;

		/**
		 * This flag can be used for type testing.
		 *
		 * @type {boolean}
		 * @readonly
		 * @default true
		 */
		this.isStorageBuffer = true;

	}

	get byteLength() {

		return getFloatLength( this.attribute.array.byteLength );

	}

	get buffer() {

		return this.attribute ? this.attribute.array : null;

	}

}

export default StorageBuffer;

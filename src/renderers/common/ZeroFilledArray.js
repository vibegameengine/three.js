export function deferZeroFilledArray( attribute, count, typeClass ) {

	let array = null;

	attribute.count = count;
	attribute.zeroFilledType = typeClass;

	Object.defineProperty( attribute, 'array', {

		configurable: true,
		enumerable: true,

		get() {

			if ( array === null ) {

				array = new typeClass( this.count * this.itemSize );
				this.zeroFilledType = null;

			}

			return array;

		},

		set( value ) {

			array = value;
			this.zeroFilledType = null;

		}

	} );

}

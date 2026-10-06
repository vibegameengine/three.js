import { Vector3 } from './Vector3.js';

function ignoreChange() {}

class ObservedVector3 extends Vector3 {

	constructor( x = 0, y = 0, z = 0 ) {

		super( x, y, z );

		this._onChangeCallback = ignoreChange;

	}

	get x() {

		return this._x;

	}

	set x( value ) {

		if ( this._x === value ) return;
		this._x = value;
		if ( this._onChangeCallback !== undefined ) this._onChangeCallback();

	}

	get y() {

		return this._y;

	}

	set y( value ) {

		if ( this._y === value ) return;
		this._y = value;
		if ( this._onChangeCallback !== undefined ) this._onChangeCallback();

	}

	get z() {

		return this._z;

	}

	set z( value ) {

		if ( this._z === value ) return;
		this._z = value;
		if ( this._onChangeCallback !== undefined ) this._onChangeCallback();

	}

	_onChange( callback ) {

		this._onChangeCallback = callback;

		return this;

	}

	toJSON() {

		return { x: this._x, y: this._y, z: this._z };

	}

}

export { ObservedVector3 };

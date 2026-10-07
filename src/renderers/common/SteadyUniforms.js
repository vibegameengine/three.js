import { NodeUpdateScope, NodeUpdateType } from '../../nodes/core/constants.js';
import { objectGroup } from '../../nodes/core/UniformGroupNode.js';

const _tracked = new WeakMap();

function markChanged( owner ) {

	owner.uniformsVersion = ( owner.uniformsVersion || 0 ) + 1;

}

function watchInPlace( owner, value ) {

	if ( value === null || value === undefined || value.isEuler !== true ) return;

	const previous = value._onChangeCallback;

	value._onChange( () => {

		previous();
		markChanged( owner );

	} );

}

export function trackUniformProperty( owner, property ) {

	let tracked = _tracked.get( owner );

	if ( tracked === undefined ) _tracked.set( owner, tracked = new Set() );
	if ( tracked.has( property ) ) return;

	tracked.add( property );
	if ( owner.uniformsVersion === undefined ) owner.uniformsVersion = 0;

	const own = Object.getOwnPropertyDescriptor( owner, property );

	if ( own === undefined || Object.hasOwn( own, 'value' ) === false ) return;

	let current = own.value;

	watchInPlace( owner, current );

	Object.defineProperty( owner, property, {
		configurable: true,
		enumerable: own.enumerable,
		get() {

			return current;

		},
		set( value ) {

			if ( value === current ) return;

			current = value;
			watchInPlace( owner, value );
			markChanged( owner );

		}
	} );

}

function refreshedOnInvalidation( node ) {

	return node.updateType === NodeUpdateType.OBJECT && ( node.updateScope === NodeUpdateScope.MATERIAL || node.updateScope === NodeUpdateScope.PRIMITIVE );

}

export function liveUpdateNodes( updateNodes ) {

	return updateNodes.filter( ( node ) => refreshedOnInvalidation( node ) === false );

}

function inMaterialGroup( binding ) {

	return binding.groupNode !== undefined && binding.groupNode.name === objectGroup.name;

}

function refilledBy( nodes ) {

	const refilled = new Set();

	for ( const node of nodes ) for ( const uniform of node.getRefilledUniforms() ) refilled.add( uniform );

	return refilled;

}

function readSources( renderObject, updateNodes ) {

	const owners = new Set( [ renderObject.material ] );
	const properties = [];
	const read = ( owner, names ) => {

		if ( owner === null || owner === undefined || names === null || names === undefined ) return;

		owners.add( owner );
		for ( const property of names ) {

			trackUniformProperty( owner, property );
			properties.push( { owner, property } );

		}

	};

	for ( const node of updateNodes ) {

		if ( node.updateScope !== NodeUpdateScope.MATERIAL ) continue;

		read( node.material !== null && node.material !== undefined ? node.material : renderObject.material, node.readsMaterial );
		read( renderObject.scene, node.readsScene );

	}

	return { owners: [ ...owners ], properties };

}

export class SteadyUniformSources {

	constructor( renderObject, textureData ) {

		const updateNodes = renderObject.getNodeBuilderState().updateNodes;
		const { owners, properties } = readSources( renderObject, updateNodes );

		this.textureData = textureData;
		this.liveNodes = liveUpdateNodes( updateNodes );
		this.owners = owners;
		this.properties = properties;
		this.uniformNodes = [];
		this.textureBindings = [];
		this.storageBindings = [];
		this.steady = true;

		const refilled = refilledBy( updateNodes.filter( refreshedOnInvalidation ) );
		const fedByLiveNodes = new Set( [ ...this.liveNodes, ...refilledBy( this.liveNodes ) ] );

		for ( const bindGroup of renderObject.getBindings() ) {

			for ( const binding of bindGroup.bindings ) {

				if ( inMaterialGroup( binding ) ) this._follow( binding, refilled, fedByLiveNodes );

			}

		}

		this.versions = [];
		this.remember();

	}

	_follow( binding, refilled, fedByLiveNodes ) {

		if ( binding.isNodeUniformsGroup === true ) {

			for ( const uniform of binding.uniforms ) {

				const node = uniform.nodeUniform.node;

				if ( fedByLiveNodes.has( node ) ) this.steady = false;
				else if ( refilled.has( node ) === false ) this.uniformNodes.push( node );

			}

		} else if ( binding.isSampledTexture === true ) {

			if ( fedByLiveNodes.has( binding.textureNode ) ) this.steady = false;
			else if ( refilled.has( binding.textureNode ) === false ) this.textureBindings.push( binding );

		} else if ( binding.isStorageBuffer === true ) {

			if ( fedByLiveNodes.has( binding.nodeUniform.node ) ) this.steady = false;
			else this.storageBindings.push( binding );

		} else if ( binding.isSampler !== true ) {

			this.steady = false;

		}

	}

	remember() {

		this.versions.length = 0;
		this._visit( ( value ) => {

			this.versions.push( value );

			return true;

		} );

	}

	changed() {

		let index = 0;

		return this._visit( ( value ) => this.versions[ index ++ ] === value ) === false;

	}

	_visitTexture( texture, same ) {

		if ( texture === null || texture === undefined || texture.isTexture !== true ) return same( texture );

		const data = this.textureData( texture );

		return same( texture ) && same( texture.version ) && same( data.generation ) && same( data.creation );

	}

	_visit( same ) {

		for ( const owner of this.owners ) {

			if ( same( owner.version ) === false || same( owner.uniformsVersion ) === false ) return false;

		}

		for ( const { owner, property } of this.properties ) {

			if ( this._visitTexture( owner[ property ], same ) === false ) return false;

		}

		for ( const node of this.uniformNodes ) {

			if ( same( node.valueVersion ) === false ) return false;

		}

		for ( const binding of this.textureBindings ) {

			if ( this._visitTexture( binding.textureNode.value, same ) === false ) return false;

		}

		for ( const binding of this.storageBindings ) {

			const attribute = binding.nodeUniform.value;

			if ( same( attribute ) === false || same( attribute.version ) === false ) return false;

		}

		return true;

	}

}

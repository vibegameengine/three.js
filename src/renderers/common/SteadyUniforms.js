import { NodeUpdateType } from '../../nodes/core/constants.js';
import { objectGroup } from '../../nodes/core/UniformGroupNode.js';

const _tracked = new WeakMap();

export function trackUniformProperty( material, property ) {

	let tracked = _tracked.get( material );

	if ( tracked === undefined ) _tracked.set( material, tracked = new Set() );
	if ( tracked.has( property ) ) return;

	tracked.add( property );

	const own = Object.getOwnPropertyDescriptor( material, property );

	if ( own === undefined || Object.hasOwn( own, 'value' ) === false ) return;

	let current = own.value;

	Object.defineProperty( material, property, {
		configurable: true,
		enumerable: own.enumerable,
		get() {

			return current;

		},
		set( value ) {

			if ( value === current ) return;

			current = value;
			material.uniformsVersion ++;

		}
	} );

}

function readsOnlyItsMaterial( node ) {

	return node.isMaterialReferenceNode === true || node.isTextureNode === true || ( node.isModelNode === true && node.readsGpuScene() === true );

}

export function liveUpdateNodes( updateNodes ) {

	return updateNodes.filter( ( node ) => node.updateType !== NodeUpdateType.OBJECT || readsOnlyItsMaterial( node ) === false );

}

function inMaterialGroup( binding ) {

	return binding.groupNode !== undefined && binding.groupNode.name === objectGroup.name;

}

function refilledBy( updateNodes ) {

	const refilled = new Set();
	const add = ( node ) => {

		if ( node === null || node === undefined ) return;

		refilled.add( node );
		if ( node.isTextureNode === true ) {

			refilled.add( node._matrixUniform );
			refilled.add( node._flipYUniform );

		}

	};

	for ( const node of updateNodes ) {

		if ( node.isReferenceNode === true || node.isMaterialReferenceNode === true ) add( node.node );
		add( node.uniformNode );
		if ( node.isTextureNode === true ) add( node );

	}

	return refilled;

}

function propertySources( material, updateNodes ) {

	const sources = [];
	const materials = new Set( [ material ] );

	for ( const node of updateNodes ) {

		if ( node.isMaterialReferenceNode !== true ) continue;

		const owner = node.material !== null && node.material !== undefined ? node.material : material;
		const property = node.property.split( '.' )[ 0 ];

		trackUniformProperty( owner, property );
		materials.add( owner );
		sources.push( { owner, property } );

	}

	return { materials: [ ...materials ], properties: sources };

}

export class SteadyUniformSources {

	constructor( renderObject, textureData ) {

		const updateNodes = renderObject.getNodeBuilderState().updateNodes;
		const refilled = refilledBy( updateNodes );
		const { materials, properties } = propertySources( renderObject.material, updateNodes );

		this.textureData = textureData;
		this.liveNodes = liveUpdateNodes( updateNodes );
		this.materials = materials;
		this.propertyTextures = properties;
		this.uniformNodes = [];
		this.textureBindings = [];
		this.storageBindings = [];
		this.steady = true;

		const fedByLiveNodes = new Set( this.liveNodes );

		for ( const node of this.liveNodes ) if ( node._output !== undefined && node._output !== null ) fedByLiveNodes.add( node._output );

		for ( const bindGroup of renderObject.getBindings() ) {

			for ( const binding of bindGroup.bindings ) {

				if ( inMaterialGroup( binding ) === false ) continue;

				this._follow( binding, refilled, fedByLiveNodes );

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

			if ( refilled.has( binding.textureNode ) === false ) this.textureBindings.push( binding );

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

		for ( const material of this.materials ) {

			if ( same( material.version ) === false || same( material.uniformsVersion ) === false ) return false;

		}

		for ( const { owner, property } of this.propertyTextures ) {

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

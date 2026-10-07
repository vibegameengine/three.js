import { NodeUpdateScope, NodeUpdateType } from '../../nodes/core/constants.js';
import { objectGroup } from '../../nodes/core/UniformGroupNode.js';
import { signalSource, unwatchSource, watchSource } from '../../core/SourceSignals.js';

const _tracked = new WeakMap();

function markChanged( owner ) {

	owner.uniformsVersion = ( owner.uniformsVersion || 0 ) + 1;
	signalSource( owner );

}

function textureValueOwner( textureNode ) {

	let owner = textureNode;

	while ( owner.referenceNode !== null && owner.referenceNode !== undefined && owner.referenceNode.isTextureNode === true ) owner = owner.referenceNode;

	return owner;

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

	constructor( renderObject ) {

		const updateNodes = renderObject.getNodeBuilderState().updateNodes;
		const { owners, properties } = readSources( renderObject, updateNodes );

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

		this.watched = [];
		this.sourcesChanged = false;
		if ( this.steady ) this.remember();

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

		this.release();

		for ( const owner of this.owners ) this._watch( owner );
		for ( const { owner, property } of this.properties ) this._watch( owner[ property ] );
		for ( const node of this.uniformNodes ) this._watch( node );

		for ( const binding of this.textureBindings ) {

			this._watch( textureValueOwner( binding.textureNode ) );
			this._watch( binding.textureNode.value );

		}

		for ( const binding of this.storageBindings ) {

			this._watch( binding.nodeUniform );
			this._watch( binding.nodeUniform.value );

		}

		this.sourcesChanged = false;

	}

	changed() {

		return this.sourcesChanged;

	}

	release() {

		for ( const source of this.watched ) unwatchSource( source, this );

		this.watched.length = 0;

	}

	_watch( source ) {

		if ( source === null || source === undefined || typeof source !== 'object' ) return;

		watchSource( source, this );
		this.watched.push( source );

	}

}

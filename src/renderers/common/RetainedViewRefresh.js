import { NodeUpdateType } from '../../nodes/core/constants.js';
import { objectGroup } from '../../nodes/core/UniformGroupNode.js';

const _bindingIds = new WeakMap();
let _nextBindingId = 0;

function identityOf( binding ) {

	let id = _bindingIds.get( binding );

	if ( id === undefined ) _bindingIds.set( binding, id = _nextBindingId ++ );

	return id;

}

function readsRenderedObject( renderer, node, updateType ) {

	if ( updateType !== NodeUpdateType.OBJECT ) return false;

	return node.readsRenderedObject === undefined || node.readsRenderedObject( renderer );

}

export function refreshRepresentatives( renderObjects ) {

	const seen = new Set();
	const representatives = [];

	for ( const renderObject of renderObjects ) {

		const materialBindings = renderObject.getMaterialBindings();

		if ( materialBindings !== null && seen.has( materialBindings ) ) continue;

		if ( materialBindings !== null ) seen.add( materialBindings );
		representatives.push( renderObject );

	}

	return representatives;

}

export function refreshFully( renderer, renderObject ) {

	const nodes = renderer._nodes;

	if ( nodes.needsRefresh( renderObject ) === false || renderer._refreshedWithMaterial( renderObject ) === true ) return;

	nodes.updateBefore( renderObject );
	nodes.updateForRender( renderObject );
	renderer._bindings.updateForRender( renderObject );
	nodes.updateAfter( renderObject );

}

export function refreshShared( renderer, renderObject, sources ) {

	if ( renderer._refreshedWithMaterial( renderObject ) === true ) return;

	const nodes = renderer._nodes;

	nodes.updateBefore( renderObject );
	nodes.updateLiveForRender( renderObject, sources.liveNodes );
	renderer._bindings.updateSharedForRender( renderObject );
	nodes.updateAfter( renderObject );

}

export function viewKey( renderer, renderObject, liveNodes ) {

	const state = renderObject.getNodeBuilderState();
	const parts = [];

	for ( const node of liveNodes ) {

		if ( readsRenderedObject( renderer, node, node.getUpdateType() ) ) return null;
		parts.push( node.id );

	}

	for ( const node of state.updateBeforeNodes ) {

		if ( readsRenderedObject( renderer, node, node.getUpdateBeforeType() ) ) return null;
		parts.push( `b${ node.id }` );

	}

	for ( const node of state.updateAfterNodes ) {

		if ( readsRenderedObject( renderer, node, node.getUpdateAfterType() ) ) return null;
		parts.push( `a${ node.id }` );

	}

	for ( const bindGroup of renderObject.getBindings() ) {

		if ( bindGroup.name === objectGroup.name ) continue;

		for ( const binding of bindGroup.bindings ) parts.push( `g${ identityOf( binding ) }` );

	}

	return parts.join( ',' );

}

class RetainedViewRefresh {

	constructor() {

		this.sources = new Map();
		this.pending = [];
		this.unsteady = [];
		this.viewed = [];
		this.views = new Map();
		this.changed = new Set();

	}

	reset( representatives ) {

		this.release();
		this.pending = [ ...representatives ];

	}

	release() {

		for ( const sources of this.sources.values() ) {

			if ( sources === null ) continue;

			sources.onChange = null;
			sources.release();

		}

		this.sources.clear();
		this.pending = [];
		this.unsteady.length = 0;
		this.viewed.length = 0;
		this.views.clear();
		this.changed.clear();

	}

	refresh( renderer, steps ) {

		const pending = this.pending;
		this.pending = [];

		for ( const renderObject of pending ) {

			steps.full( renderObject );
			this._classify( renderer, renderObject, steps.sources( renderObject ) );

		}

		for ( const renderObject of this.unsteady ) steps.full( renderObject );

		this._refreshChanged( steps );

		for ( const renderObject of this.viewed ) steps.shared( renderObject, this.sources.get( renderObject ) );

	}

	_refreshChanged( steps ) {

		const done = new Set();

		while ( this.changed.size > 0 ) {

			const batch = [ ...this.changed ].filter( ( renderObject ) => done.has( renderObject ) === false );

			if ( batch.length === 0 ) return;

			for ( const renderObject of batch ) {

				this.changed.delete( renderObject );
				steps.full( renderObject );
				this.sources.get( renderObject ).remember();
				this.changed.delete( renderObject );
				done.add( renderObject );

			}

		}

	}

	_classify( renderer, renderObject, sources ) {

		this.sources.set( renderObject, sources );

		if ( sources === null ) {

			this.unsteady.push( renderObject );
			return;

		}

		sources.onChange = () => this.changed.add( renderObject );

		const key = viewKey( renderer, renderObject, sources.liveNodes );

		if ( key !== null && this.views.has( key ) ) return;

		if ( key !== null ) this.views.set( key, renderObject );

		this.viewed.push( renderObject );

	}

}

export default RetainedViewRefresh;

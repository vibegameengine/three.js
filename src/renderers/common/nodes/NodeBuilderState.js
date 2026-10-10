import BindGroup from '../BindGroup.js';
import { renderGroup } from '../../../nodes/core/UniformGroupNode.js';

const _viewGroupsOff = new URLSearchParams( globalThis.location?.search ?? '' ).get( 'viewGroups' ) === '0';
const _viewGroups = new WeakMap();
const _viewBindings = new WeakMap();

function viewBinding( binding, view ) {

	let clones = _viewBindings.get( view );
	if ( clones === undefined ) _viewBindings.set( view, clones = new Map() );

	let clone = clones.get( binding );

	if ( clone === undefined ) {

		clone = binding.clone();
		if ( clone.isUniformsGroup === true ) {

			clone._buffer = null;
			clone._values = null;
			clone._updateRanges = [];

		}

		clones.set( binding, clone );

	}

	return clone;

}

/**
 * The render-group bind group a view draws with. Every camera gets its own copy of each shared
 * render group, holding its own uniform buffers, as every view has its own view uniform buffer:
 * a pass drawn from another camera then writes that camera's buffers instead of rewriting the ones
 * draws recorded for the first camera still read.
 *
 * @private
 * @param {BindGroup} group - The render group shared across node builder states.
 * @param {Object} view - The camera the draws are made from.
 * @return {BindGroup} The view's own copy of the group.
 */
function viewGroup( group, view ) {

	let groups = _viewGroups.get( view );
	if ( groups === undefined ) _viewGroups.set( view, groups = new Map() );

	let copy = groups.get( group );

	if ( copy === undefined ) {

		copy = new BindGroup( group.name, group.bindings.map( ( binding ) => viewBinding( binding, view ) ), group.index, group.bindingsReference );
		copy.sharedAcrossStates = true;
		groups.set( group, copy );

	}

	return copy;

}

/**
 * This module represents the state of a node builder after it was
 * used to build the nodes for a render object. The state holds the
 * results of the build for further processing in the renderer.
 *
 * Render objects with identical cache keys share the same node builder state.
 *
 * @private
 */
class NodeBuilderState {

	/**
	 * Constructs a new node builder state.
	 *
	 * @param {string} vertexShader - The native vertex shader code.
	 * @param {string} fragmentShader - The native fragment shader code.
	 * @param {string} computeShader - The native compute shader code.
	 * @param {Array<NodeAttribute>} nodeAttributes - An array of node attributes.
	 * @param {Array<BindGroup>} bindings - An array of bind groups.
	 * @param {Array<Node>} updateNodes - An array of nodes that implement their `update()` method.
	 * @param {Array<Node>} updateBeforeNodes - An array of nodes that implement their `updateBefore()` method.
	 * @param {Array<Node>} updateAfterNodes - An array of nodes that implement their `updateAfter()` method.
	 * @param {NodeMaterialObserver} observer - A node material observer.
	 * @param {Array<Object>} transforms - An array with transform attribute objects. Only relevant when using compute shaders with WebGL 2.
	 */
	constructor( vertexShader, fragmentShader, computeShader, nodeAttributes, bindings, updateNodes, updateBeforeNodes, updateAfterNodes, observer, transforms = [] ) {

		/**
		 * The native vertex shader code.
		 *
		 * @type {string}
		 */
		this.vertexShader = vertexShader;

		/**
		 * The native fragment shader code.
		 *
		 * @type {string}
		 */
		this.fragmentShader = fragmentShader;

		/**
		 * The native compute shader code.
		 *
		 * @type {string}
		 */
		this.computeShader = computeShader;

		/**
		 * An array with transform attribute objects.
		 * Only relevant when using compute shaders with WebGL 2.
		 *
		 * @type {Array<Object>}
		 */
		this.transforms = transforms;

		/**
		 * An array of node attributes representing
		 * the attributes of the shaders.
		 *
		 * @type {Array<NodeAttribute>}
		 */
		this.nodeAttributes = nodeAttributes;

		/**
		 * An array of bind groups representing the uniform or storage
		 * buffers, texture or samplers of the shader.
		 *
		 * @type {Array<BindGroup>}
		 */
		this.bindings = bindings;

		/**
		 * An array of nodes that implement their `update()` method.
		 *
		 * @type {Array<Node>}
		 */
		this.updateNodes = updateNodes;

		/**
		 * An array of nodes that implement their `updateBefore()` method.
		 *
		 * @type {Array<Node>}
		 */
		this.updateBeforeNodes = updateBeforeNodes;

		/**
		 * An array of nodes that implement their `updateAfter()` method.
		 *
		 * @type {Array<Node>}
		 */
		this.updateAfterNodes = updateAfterNodes;

		/**
		 * A node material observer.
		 *
		 * @type {NodeMaterialObserver}
		 */
		this.observer = observer;

		/**
		 * How often this state is used by render objects.
		 *
		 * @type {number}
		 */
		this.usedTimes = 0;

		this.materialBindings = null;

	}

	shareBindings( material, view = null ) {

		if ( this.materialBindings === null ) return null;

		let byView = this.materialBindings.get( material );
		if ( byView === undefined ) this.materialBindings.set( material, byView = new Map() );

		let shared = byView.get( view );

		if ( shared === undefined ) {

			shared = { bindings: this.createBindings( view ), users: 0, renderId: - 1, view };
			byView.set( view, shared );

		}

		shared.users ++;

		return shared;

	}

	releaseBindings( material, shared ) {

		shared.users --;

		if ( shared.users > 0 ) return false;

		const byView = this.materialBindings.get( material );
		byView.delete( shared.view );
		if ( byView.size === 0 ) this.materialBindings.delete( material );

		return true;

	}

	/**
	 * This method is used to create a array of bind groups based
	 * on the existing bind groups of this state. Shared groups are
	 * not cloned; a shared render group is the given view's own copy.
	 *
	 * @param {?Object} [view=null] - The camera the bindings draw from.
	 * @return {Array<BindGroup>} A array of bind groups.
	 */
	createBindings( view = null ) {

		const bindings = [];

		for ( const instanceGroup of this.bindings ) {

			const shared = instanceGroup.bindings[ 0 ].groupNode.shared; // All bindings in the group must have the same groupNode.

			if ( shared !== true ) {

				const bindingsGroup = new BindGroup( instanceGroup.name, [], instanceGroup.index, instanceGroup.bindingsReference );
				bindings.push( bindingsGroup );

				for ( const instanceBinding of instanceGroup.bindings ) {

					bindingsGroup.bindings.push( instanceBinding.clone() );

				}

			} else if ( view !== null && _viewGroupsOff === false && instanceGroup.bindings[ 0 ].groupNode === renderGroup ) {

				bindings.push( viewGroup( instanceGroup, view ) );

			} else {

				bindings.push( instanceGroup );

			}

		}

		return bindings;

	}

}

export default NodeBuilderState;

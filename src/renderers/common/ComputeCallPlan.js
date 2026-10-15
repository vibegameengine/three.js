/**
 * Everything a compute call needs that does not change from one frame to the next, taken once
 * from the full path: the nodes to update, the bind groups, and the backend records of the
 * pipeline, of each bind group and of the node. A later call refreshes the nodes and the
 * bindings and encodes straight from these references instead of looking each one up again.
 *
 * @private
 */
class ComputeCallPlan {

	constructor( renderer, computeNode, bindGroups, pipeline ) {

		const backend = renderer.backend;

		this.version = computeNode.version;
		this.updateNodes = Array.from( renderer._nodes.getForCompute( computeNode ).updateNodes );
		this.bindGroups = bindGroups;
		this.pipeline = pipeline;
		this.pipelineData = backend.get( pipeline );
		this.groupData = bindGroups.map( ( bindGroup ) => backend.get( bindGroup ) );
		this.nodeData = backend.get( computeNode );

	}

	refresh( nodeFrame, bindings ) {

		const updateNodes = this.updateNodes;

		for ( let i = 0, l = updateNodes.length; i < l; i ++ ) nodeFrame.updateNode( updateNodes[ i ] );

		const bindGroups = this.bindGroups;

		for ( let i = 0, l = bindGroups.length; i < l; i ++ ) bindings._update( bindGroups[ i ], bindGroups );

	}

}

export default ComputeCallPlan;

import DataMap from './DataMap.js';
import { AttributeType } from './Constants.js';
import { DynamicDrawUsage } from '../../constants.js';
import { objectGroup } from '../../nodes/core/UniformGroupNode.js';

/**
 * This renderer module manages the bindings of the renderer.
 *
 * @private
 * @augments DataMap
 */
class Bindings extends DataMap {

	/**
	 * Constructs a new bindings management component.
	 *
	 * @param {Backend} backend - The renderer's backend.
	 * @param {NodeManager} nodes - Renderer component for managing nodes related logic.
	 * @param {Textures} textures - Renderer component for managing textures.
	 * @param {Attributes} attributes - Renderer component for managing attributes.
	 * @param {Pipelines} pipelines - Renderer component for managing pipelines.
	 * @param {Info} info - Renderer component for managing metrics and monitoring data.
	 */
	constructor( backend, nodes, textures, attributes, pipelines, info ) {

		super();

		/**
		 * The renderer's backend.
		 *
		 * @type {Backend}
		 */
		this.backend = backend;

		this.uniformBufferHolders = new WeakMap();

		/**
		 * Renderer component for managing textures.
		 *
		 * @type {Textures}
		 */
		this.textures = textures;

		/**
		 * Renderer component for managing pipelines.
		 *
		 * @type {Pipelines}
		 */
		this.pipelines = pipelines;

		/**
		 * Renderer component for managing attributes.
		 *
		 * @type {Attributes}
		 */
		this.attributes = attributes;

		/**
		 * Renderer component for managing nodes related logic.
		 *
		 * @type {NodeManager}
		 */
		this.nodes = nodes;

		/**
		 * Renderer component for managing metrics and monitoring data.
		 *
		 * @type {Info}
		 */
		this.info = info;

		this.pipelines.bindings = this; // assign bindings to pipelines

	}

	/**
	 * Returns the bind groups for the given render object.
	 *
	 * @param {RenderObject} renderObject - The render object.
	 * @return {Array<BindGroup>} The bind groups.
	 */
	getForRender( renderObject ) {

		const bindings = renderObject.getBindings();

		const renderObjectData = this.get( renderObject );

		if ( renderObjectData.initialized !== true ) {

			// bind groups are created once per object

			this._createBindings( bindings );

			renderObjectData.initialized = true;

		}

		return bindings;

	}

	/**
	 * Returns the bind groups for the given compute node.
	 *
	 * @param {Node} computeNode - The compute node.
	 * @return {Array<BindGroup>} The bind groups.
	 */
	getForCompute( computeNode ) {

		const bindings = this.nodes.getForCompute( computeNode ).bindings;
		const computeNodeData = this.get( computeNode );

		if ( computeNodeData.initialized !== true || computeNodeData.bindings !== bindings ) {

			// bind groups are created once per compute node version

			if ( computeNodeData.bindings !== undefined ) {

				this._destroyBindings( computeNodeData.bindings );

			}

			this._createBindings( bindings );

			computeNodeData.initialized = true;
			computeNodeData.bindings = bindings;

		}

		return bindings;

	}

	/**
	 * Updates the bindings for the given compute node.
	 *
	 * @param {Node} computeNode - The compute node.
	 */
	updateForCompute( computeNode ) {

		this._updateBindings( this.getForCompute( computeNode ) );

	}

	/**
	 * Updates the bindings for the given render object.
	 *
	 * @param {RenderObject} renderObject - The render object.
	 */
	updateForRender( renderObject ) {

		this._updateBindings( this.getForRender( renderObject ) );

	}

	updateViewGroupsForRender( renderObject ) {

		const bindings = this.getForRender( renderObject );

		for ( const bindGroup of bindings ) {

			if ( bindGroup.name !== objectGroup.name ) this._update( bindGroup, bindings );

		}

	}

	/**
	 * Updates only the shared uniform buffers of the given render object.
	 *
	 * @param {RenderObject} renderObject - The render object.
	 */
	updateSharedForRender( renderObject ) {

		const bindings = this.getForRender( renderObject );

		for ( const bindGroup of bindings ) {

			for ( const binding of bindGroup.bindings ) {

				if ( ( binding.isNodeUniformsGroup === true || binding.isNodeUniformBuffer === true ) && binding.groupNode.shared === true ) {

					const updatedGroup = this.nodes.updateGroup( binding );

					if ( updatedGroup === false ) continue;

					const updated = binding.update();

					if ( updated ) {

						this.backend.updateBinding( binding );

					}

					if ( binding.updateRanges.length > 0 ) binding.clearUpdateRanges();

				}

			}

		}

	}

	/**
	 * Deletes the bindings for the given compute node.
	 *
	 * @param {Node} computeNode - The compute node.
	 */
	deleteForCompute( computeNode ) {

		const computeNodeData = this.get( computeNode );
		const bindings = computeNodeData.bindings || this.nodes.getForCompute( computeNode ).bindings;

		this._destroyBindings( bindings );

		this.delete( computeNode );

	}

	/**
	 * Deletes the bindings for the given renderObject node.
	 *
	 * @param {RenderObject} renderObject - The renderObject.
	 */
	deleteForRender( renderObject ) {

		const bindings = renderObject.getBindings();
		const shared = renderObject.materialBindings;

		if ( shared !== null ) renderObject.getNodeBuilderState().releaseBindings( renderObject.material, shared );

		if ( this.get( renderObject ).initialized === true ) this._destroyBindings( bindings );

		this.delete( renderObject );

	}

	/**
	 * Creates the bindings for the given array of bindings.
	 *
	 * @param {Array<BindGroup>} bindings - The bind groups.
	 */
	_createBindings( bindings ) {

		for ( const bindGroup of bindings ) {

			// binding group

			const groupData = this.get( bindGroup );

			if ( groupData.bindGroup === undefined ) {

				// initialize

				for ( const binding of bindGroup.bindings ) {

					if ( binding.isUniformBuffer ) {

						this.uniformBufferHolders.set( binding, ( this.uniformBufferHolders.get( binding ) ?? 0 ) + 1 );
						this.backend.createUniformBuffer( binding );
						this.info.createUniformBuffer( binding );

					} else if ( binding.isSampledTexture ) {

						this.textures.updateTexture( binding.texture );

						const texturesTextureData = this.textures.get( binding.texture );

						binding.generation = texturesTextureData.generation;
						binding.creation = texturesTextureData.creation;

					} else if ( binding.isSampler ) {

						this.textures.updateSampler( binding );

					} else if ( binding.isStorageBuffer ) {

						const attribute = binding.attribute;
						const attributeType = attribute.isIndirectStorageBufferAttribute ? AttributeType.INDIRECT : AttributeType.STORAGE;

						this.attributes.update( attribute, attributeType );

						this.backend.get( binding ).attribute = attribute;

					}

				}

				// each object defines an array of bindings (ubos, textures, samplers etc.)

				this.backend.createBindings( bindGroup, bindings, '' );

				groupData.bindGroup = bindGroup;
				groupData.usedTimes = 1;

			} else {

				groupData.usedTimes ++;

			}

		}

	}

	/**
	 * Deletes the given array of bindings.
	 *
	 * @param {Array<BindGroup>} bindings - The bind groups.
	 */
	_destroyBindings( bindings ) {

		for ( const bindGroup of bindings ) {

			const groupData = this.get( bindGroup );
			groupData.usedTimes --;

			if ( groupData.usedTimes === 0 ) {

				for ( const binding of bindGroup.bindings ) {

					if ( binding.isUniformBuffer ) {

						const holders = ( this.uniformBufferHolders.get( binding ) ?? 1 ) - 1;

						if ( holders > 0 ) {

							this.uniformBufferHolders.set( binding, holders );
							continue;

						}

						this.uniformBufferHolders.delete( binding );
						this.backend.destroyUniformBuffer( binding );
						this.info.destroyUniformBuffer( binding );

						// release arrays

						binding.release();

					} else if ( binding.isSampler ) {

						if ( binding.isSampledTexture !== true ) {

							this.backend.destroySampler( binding );

						} else if ( binding.texture !== null ) {

							// untrack destroyed bind group from its texture

							const textureData = this.textures.get( binding.texture );
							if ( textureData.bindGroups !== undefined ) textureData.bindGroups.delete( bindGroup );

						}

						binding.release();

					}

				}

				this.backend.deleteBindGroupData( bindGroup );
				this.delete( bindGroup );

			}

		}

	}

	/**
	 * Updates the given array of bindings.
	 *
	 * @param {Array<BindGroup>} bindings - The bind groups.
	 */
	_updateBindings( bindings ) {

		for ( const bindGroup of bindings ) {

			this._update( bindGroup, bindings );

		}

	}

	/**
	 * Updates the given bind group.
	 *
	 * @param {BindGroup} bindGroup - The bind group to update.
	 * @param {Array<BindGroup>} bindings - The bind groups.
	 */
	_refreshPlanOf( bindGroup ) {

		let plan = bindGroup.refreshPlan;

		if ( plan === undefined ) {

			plan = bindGroup.bindings.map( ( binding ) => ( { binding, group: this.nodes.groupUpdateState( binding ), attribute: null, attributeData: null, source: null } ) );
			bindGroup.refreshPlan = plan;

		}

		return plan;

	}

	_refreshStorage( entry ) {

		const attribute = entry.binding.attribute;

		if ( entry.attribute !== attribute ) {

			entry.attribute = attribute;
			entry.attributeData = this.attributes.get( attribute );
			entry.source = attribute.isInterleavedBufferAttribute ? attribute.data : attribute;

		}

		const version = entry.attributeData.version;
		const source = entry.source;

		if ( version !== undefined && version >= source.version && source.usage !== DynamicDrawUsage ) return;

		this.attributes.update( attribute, attribute.isIndirectStorageBufferAttribute ? AttributeType.INDIRECT : AttributeType.STORAGE );

	}

	_update( bindGroup, bindings ) {

		const { backend } = this;

		let needsBindingsUpdate = false;

		// iterate over all bindings and check if buffer updates or a new binding group is required

		const plan = this._refreshPlanOf( bindGroup );

		for ( let i = 0, l = plan.length; i < l; i ++ ) {

			const entry = plan[ i ];
			const binding = entry.binding;

			// every uniforms group is a uniform buffer. So if no update is required,
			// we move one with the next binding. Otherwise the next if block will update the group.

			if ( this.nodes.updateGroupState( entry.group ) === false ) continue;

			//

			if ( binding.isStorageBuffer ) {

				const attribute = binding.attribute;
				const bindingData = backend.get( binding );

				this._refreshStorage( entry );

				if ( bindingData.attribute !== attribute ) {

					bindingData.attribute = attribute;

					needsBindingsUpdate = true;

				}

			}

			if ( binding.isUniformBuffer ) {

				const updated = binding.update();

				if ( updated ) {

					backend.updateBinding( binding );

				}

			} else if ( binding.isSampledTexture ) {

				const updated = binding.update();

				// get the texture data after the update, to sync the texture reference from node

				const texture = binding.texture;
				const texturesTextureData = this.textures.get( texture );

				if ( updated || texturesTextureData.initialized !== true ) {

					// version: update the texture data or create a new one

					this.textures.updateTexture( texture );

					// keep track which bind groups refer to the current texture (this is needed for dispose)

					texturesTextureData.bindGroups.add( bindGroup );

				}

				// generation: update the bindings if a new texture has been created, here or by another group

				if ( binding.generation !== texturesTextureData.generation || binding.creation !== texturesTextureData.creation ) {

					binding.generation = texturesTextureData.generation;
					binding.creation = texturesTextureData.creation;

					needsBindingsUpdate = true;

				}

				if ( texture.isStorageTexture === true && texture.mipmapsAutoUpdate === true ) {

					const textureData = this.get( texture );

					if ( binding.store === true ) {

						textureData.needsMipmap = true;

					} else if ( this.textures.needsMipmaps( texture ) && textureData.needsMipmap === true ) {

						this.backend.generateMipmaps( texture );

						textureData.needsMipmap = false;

					}

				}

			} else if ( binding.isSampler ) {

				const updated = binding.update();

				if ( updated ) {

					const samplerKey = this.textures.updateSampler( binding );

					if ( binding.samplerKey !== samplerKey ) {

						binding.samplerKey = samplerKey;

						needsBindingsUpdate = true;

					}

				}

			}

			if ( binding.isBuffer && binding.updateRanges.length > 0 ) {

				binding.clearUpdateRanges();

			}

		}

		if ( needsBindingsUpdate === true ) {

			this.backend.updateBindings( bindGroup, bindings, this._cacheKey( bindGroup ) );

		}

	}

	/**
	 * The textures and samplers a bind group is made with: every texture by its id and the
	 * GPU texture it currently has, every sampler by its key. Groups that bind an external
	 * or a placeholder texture are not cached.
	 *
	 * @private
	 * @param {BindGroup} bindGroup - The bind group.
	 * @return {string} The key, or '' when the group must not be cached.
	 */
	_cacheKey( bindGroup ) {

		let key = '';

		for ( const binding of bindGroup.bindings ) {

			if ( binding.isSampledTexture ) {

				const texture = binding.texture;
				const texturesTextureData = this.textures.get( texture );

				if ( this.backend.get( texture ).externalTexture !== undefined || texturesTextureData.isDefaultTexture ) return '';

				key += `${ texture.id }:${ texturesTextureData.creation }|`;

			} else if ( binding.isSampler ) {

				key += `s${ binding.samplerKey }|`;

			} else if ( binding.isStorageBuffer ) {

				key += `b${ binding.attribute.id }|`;

			}

		}

		return key;

	}

}

export default Bindings;

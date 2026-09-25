import DataMap from './DataMap.js';
import { AttributeType } from './Constants.js';

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
	 * @param {Nodes} nodes - Renderer component for managing nodes related logic.
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
		 * @type {Nodes}
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

		for ( const bindGroup of bindings ) {

			const groupData = this.get( bindGroup );

			if ( groupData.bindGroup === undefined ) {

				// each object defines an array of bindings (ubos, textures, samplers etc.)

				this._init( bindGroup );

				this.backend.createBindings( bindGroup, bindings, 0 );

				groupData.bindGroup = bindGroup;

			}

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

		for ( const bindGroup of bindings ) {

			const groupData = this.get( bindGroup );

			if ( groupData.bindGroup === undefined ) {

				this._init( bindGroup );

				this.backend.createBindings( bindGroup, bindings, 0 );

				groupData.bindGroup = bindGroup;

			}

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

	/**
	 * Deletes the bindings for the given compute node.
	 *
	 * @param {Node} computeNode - The compute node.
	 */
	deleteForCompute( computeNode ) {

		const bindings = this.nodes.getForCompute( computeNode ).bindings;

		for ( const bindGroup of bindings ) {

			this.backend.deleteBindGroupData( bindGroup );
			this.delete( bindGroup );

		}

	}

	/**
	 * Deletes the bindings for the given renderObject node.
	 *
	 * @param {RenderObject} renderObject - The renderObject.
	 */
	deleteForRender( renderObject ) {

		const bindings = renderObject.getBindings();
		const shared = renderObject.materialBindings;

		if ( shared !== null && renderObject.getNodeBuilderState().releaseBindings( renderObject.material, shared ) === false ) return;

		for ( const bindGroup of bindings ) {

			if ( shared !== null && bindGroup.bindings[ 0 ].groupNode.shared === true ) continue;

			this.backend.deleteBindGroupData( bindGroup );
			this.delete( bindGroup );

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
	 * Initializes the given bind group.
	 *
	 * @param {BindGroup} bindGroup - The bind group to initialize.
	 */
	_init( bindGroup ) {

		for ( const binding of bindGroup.bindings ) {

			if ( binding.isSampledTexture ) {

				this.textures.updateTexture( binding.texture );

				const texturesTextureData = this.textures.get( binding.texture );

				binding.generation = texturesTextureData.generation;
				binding.creation = texturesTextureData.creation;

			} else if ( binding.isSampler ) {

				this.textures.updateSampler( binding.texture );

			} else if ( binding.isStorageBuffer ) {

				const attribute = binding.attribute;
				const attributeType = attribute.isIndirectStorageBufferAttribute ? AttributeType.INDIRECT : AttributeType.STORAGE;

				this.attributes.update( attribute, attributeType );

			}

		}

	}

	/**
	 * Updates the given bind group.
	 *
	 * @param {BindGroup} bindGroup - The bind group to update.
	 * @param {Array<BindGroup>} bindings - The bind groups.
	 */
	_update( bindGroup, bindings ) {

		const { backend } = this;

		let needsBindingsUpdate = false;

		// iterate over all bindings and check if buffer updates or a new binding group is required

		for ( const binding of bindGroup.bindings ) {

			const updatedGroup = this.nodes.updateGroup( binding );

			// every uniforms group is a uniform buffer. So if no update is required,
			// we move one with the next binding. Otherwise the next if block will update the group.

			if ( updatedGroup === false ) continue;

			//

			if ( binding.isStorageBuffer ) {

				if ( binding.nodeUniform && binding.nodeUniform.value !== binding.attribute ) {

					binding.attribute = binding.nodeUniform.value;
					needsBindingsUpdate = true;

				}

				const attribute = binding.attribute;
				const attributeType = attribute.isIndirectStorageBufferAttribute ? AttributeType.INDIRECT : AttributeType.STORAGE;

				this.attributes.update( attribute, attributeType );


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

					const samplerKey = this.textures.updateSampler( binding.texture );

					if ( binding.samplerKey !== samplerKey ) {

						binding.samplerKey = samplerKey;

						needsBindingsUpdate = true;

					}

				}

			}

		}

		if ( needsBindingsUpdate === true ) {

			this._recreateDestroyedSamplers( bindGroup );

			this.backend.updateBindings( bindGroup, bindings, this._cacheKey( bindGroup ) );

		}

	}

	_recreateDestroyedSamplers( bindGroup ) {

		for ( const binding of bindGroup.bindings ) {

			if ( binding.isSampler !== true || binding.isSampledTexture === true ) continue;

			if ( this.backend.get( binding.texture ).sampler === undefined ) {

				binding.samplerKey = this.textures.updateSampler( binding.texture );

			}

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

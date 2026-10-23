const textureKinds = [
	'isDepthTexture',
	'isCubeTexture',
	'isArrayTexture',
	'isDataArrayTexture',
	'isCompressedArrayTexture',
	'is3DTexture',
	'isData3DTexture',
	'isStorageTexture',
	'isVideoTexture',
	'isExternalTexture'
];

export function textureBindingKey( texture ) {

	let key = '';

	for ( const kind of textureKinds ) key += texture[ kind ] === true ? '1' : '0';

	const samples = texture.renderTarget?.samples ?? 0;

	return key + ':' + texture.type + ':' + texture.format + ':' + ( texture.compareFunction ?? '' ) + ':' + ( samples > 1 ? samples : 1 ) + ':' + ( texture.normalized === true ? 'n' : '' ) + ':' + texture.channel;

}

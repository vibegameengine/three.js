export const WRAPPED_GROUP_STRIDE = 128;

const numberOperations = {
	constant: ( value ) => value,
	above: ( a, b ) => a > b,
	pick: ( condition, whenTrue, whenFalse ) => ( condition ? whenTrue : whenFalse ),
	ceilDivide: ( a, b ) => Math.ceil( a / b )
};

export function wrappedGroupCountWith( operations, groups, limit ) {

	const { constant, above, pick, ceilDivide } = operations;
	const stride = constant( WRAPPED_GROUP_STRIDE );
	const wrapsX = above( groups, constant( limit ) );
	const rows = pick( wrapsX, ceilDivide( groups, stride ), constant( 1 ) );
	const wrapsY = above( rows, constant( limit ) );

	return [
		pick( wrapsX, stride, groups ),
		pick( wrapsY, stride, rows ),
		pick( wrapsY, ceilDivide( rows, stride ), constant( 1 ) )
	];

}

export function wrappedGroupCount( groups, limit ) {

	if ( limit < WRAPPED_GROUP_STRIDE ) throw new Error( `WrappedDispatch: a dimension limit of ${ limit } is below the wrap stride ${ WRAPPED_GROUP_STRIDE }.` );

	return wrappedGroupCountWith( numberOperations, groups, limit );

}

export function linearGroupOf( x, y, z ) {

	return x + ( z * WRAPPED_GROUP_STRIDE + y ) * WRAPPED_GROUP_STRIDE;

}

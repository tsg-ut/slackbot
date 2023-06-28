const formatCoordinate = (coordinate: number, positiveSymbol: string, negativeSymbol: string) => {
	const absoluteCoordinate = Math.abs(coordinate);
	const degrees = Math.floor(absoluteCoordinate);
	const minutes = Math.floor((absoluteCoordinate - degrees) * 60);
	const seconds = ((absoluteCoordinate - degrees - minutes / 60) * 3600).toFixed(2);
	return `${degrees}°${minutes.toString().padStart(2, '0')}'${seconds.toString().padStart(5, '0')}" ${coordinate >= 0 ? positiveSymbol : negativeSymbol}`;
};

const convertToDegreeMinuteSecond = (latitude: number, longitude: number) => {
	const latitudeString = formatCoordinate(latitude, 'N', 'S');
	const longitudeString = formatCoordinate(longitude, 'E', 'W');

	return `${latitudeString} ${longitudeString}`;
};

// eslint-disable-next-line import/prefer-default-export
export const getGoogleMapsLink = (latitude: number, longitude: number) => (
	`<https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}|${convertToDegreeMinuteSecond(latitude, longitude)}>`
);

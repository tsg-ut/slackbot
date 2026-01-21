"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGoogleMapsLink = void 0;
const formatCoordinate = (coordinate, positiveSymbol, negativeSymbol) => {
    const absoluteCoordinate = Math.abs(coordinate);
    const degrees = Math.floor(absoluteCoordinate);
    const minutes = Math.floor((absoluteCoordinate - degrees) * 60);
    const seconds = ((absoluteCoordinate - degrees - minutes / 60) * 3600).toFixed(2);
    return `${degrees}°${minutes.toString().padStart(2, '0')}'${seconds.toString().padStart(5, '0')}" ${coordinate >= 0 ? positiveSymbol : negativeSymbol}`;
};
const convertToDegreeMinuteSecond = (latitude, longitude) => {
    const latitudeString = formatCoordinate(latitude, 'N', 'S');
    const longitudeString = formatCoordinate(longitude, 'E', 'W');
    return `${latitudeString} ${longitudeString}`;
};
// eslint-disable-next-line import/prefer-default-export
const getGoogleMapsLink = (latitude, longitude) => (`<https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}|${convertToDegreeMinuteSecond(latitude, longitude)}>`);
exports.getGoogleMapsLink = getGoogleMapsLink;

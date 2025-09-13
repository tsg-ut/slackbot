## Instruction

Below are the current weather conditions at a certain location on Earth. Using these numbers, please write a sentence in Japanese that briefly and concisely describes the current weather.

## Current weather condition

* latitude of the place: {lat}
* longitude of the place: {lon}
* time: {current_time}
* today's sunrise: {sunrise}
* today's sunset: {sunset}
* temperature: {temperature} degree Celsius
* sensible temperature: {feels_like} degree Celsius
* atmospheric pressure: {pressure} hPa
* humidity: {humidity} %
* cloudiness: {clouds} %
* average visibility: {visibility} m
* wind speed: {wind_speed} m/s
* wind degree: {wind_deg} degrees
* current weather: {weathers}
* today's weather forecast: {todays_forecast}

## Response Format

IMPORTANT: Output only one Japanese sentence describing the weather in the specified format. Please do not include any explanation, reason, or additional comments.

Please write one sentence that succinctly describes the current weather conditions in the format "[PLACE]では、～。". Do not replace [PLACE] with a specific place name. Just output "[PLACE]" as is. Do not include numerical values ​​such as temperature, air pressure, wind speed, or specific information such as wind direction in your output. Instead, describe the weather in abstract terms to describe how it feels to humans.

## Example response

* [PLACE]では、雷を伴う激しい雨が降っています。
* [PLACE]は、快晴です。
* [PLACE]では、季節外れの涼しい風が吹いています。
* [PLACE]は、蒸し暑い熱帯夜となっています。
* [PLACE]では、強い空っ風が吹いています。
* [PLACE]は、厚い雲に覆われています。
* [PLACE]は、激しい吹雪です。

## Instruction

Below is a forecast of weather conditions for a certain location on Earth for the next three days. Using this information, please write a single sentence in Japanese that briefly explains the upcoming weather forecast.

## Weather forecasts

### Today

* forecast summary: {day0_summary}
* min temperature: {day0_min_temp} degree Celsius
* max temperature: {day0_max_temp} degree Celsius
* temperature at night: {day0_night_temp} degree Celsius
* atmospheric pressure: {day0_pressure} hPa
* wind speed: {day0_wind_speed} m/s
* cloudiness: {day0_clouds} %
* maximum value of UV index for the day: {day0_uvi}
* probability of precipitation: {day0_pop} %
* precipitation volume of rain: {day0_rain} mm
* precipitation volume of snow: {day0_snow} mm
* weathers: {day0_weathers}
* humidity: {day0_humidity} %

### Tomorrow

* forecast summary: {day1_summary}
* min temperature: {day1_min_temp} degree Celsius
* max temperature: {day1_max_temp} degree Celsius
* temperature at night: {day1_night_temp} degree Celsius
* atmospheric pressure: {day1_pressure} hPa
* wind speed: {day1_wind_speed} m/s
* cloudiness: {day1_clouds} %
* maximum value of UV index for the day: {day1_uvi}
* probability of precipitation: {day1_pop} %
* precipitation volume of rain: {day1_rain} mm
* precipitation volume of snow: {day1_snow} mm
* weathers: {day1_weathers}
* humidity: {day1_humidity} %

### Day after tomorrow

* forecast summary: {day2_summary}
* min temperature: {day2_min_temp} degree Celsius
* max temperature: {day2_max_temp} degree Celsius
* temperature at night: {day2_night_temp} degree Celsius
* atmospheric pressure: {day2_pressure} hPa
* wind speed: {day2_wind_speed} m/s
* cloudiness: {day2_clouds} %
* maximum value of UV index for the day: {day2_uvi}
* probability of precipitation: {day2_pop} %
* precipitation volume of rain: {day2_rain} mm
* precipitation volume of snow: {day2_snow} mm
* weathers: {day2_weathers}
* humidity: {day2_humidity} %

## Response Format

IMPORTANT: Output only one Japanese sentence describing the weather forecast in the specified format. Please do not include any explanation, reason, or additional comments.

Please write one sentence that succinctly describes the weather forecast in the format "～でしょう。". Do not include numerical values ​​such as temperature, air pressure, wind speed, or specific information such as wind direction in your output. Instead, describe the weather in abstract terms to describe how it feels to humans. Instead of including all the information given in the output, try to output only the information you think is particularly important and keep it as concise and short as possible.

## Example response

* 今後数日間は蒸し暑い夜になるでしょう。
* 明日から明後日にかけて強い風が吹き、明後日の晩は特に激しい雨が降るでしょう。
* 日差しが強く乾燥した日が続くでしょう。
* 本日の午後は雷を伴う雨が降るでしょう。
* 寒い日が続き、明後日にはちらほらと雪が見られるでしょう。
* 今日と明日は、厚い雲に覆われたはっきりしない天気が続くでしょう。
* 本日の夜は大嵐になる見込みです。

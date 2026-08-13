import dayjs from 'dayjs';
import dayjsUtc from 'dayjs/plugin/utc.js';
import dayjsTimezone from 'dayjs/plugin/timezone.js';

dayjs.extend(dayjsUtc);
dayjs.extend(dayjsTimezone);

export default dayjs;
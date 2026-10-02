function parseList(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const preferences = {
  testCentres: parseList(process.env.TEST_CENTRES),

  earliestDate: process.env.EARLIEST_DATE || "1970-01-01",

  latestDate: process.env.LATEST_DATE || "9999-12-31",

  allowedDaysOfWeek: parseList(process.env.ALLOWED_DAYS_OF_WEEK).map(Number),

  earliestTime: process.env.EARLIEST_TIME || "00:00",
  latestTime: process.env.LATEST_TIME || "23:59",
};

export const maxAutoBookings = 1;

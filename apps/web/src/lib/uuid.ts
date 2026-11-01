const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Any version: what Postgres' uuid type accepts, so a bad id is a 400 rather than a cast error. */
export const isUuid = (value: string): boolean => UUID.test(value);

// Rental-search URL encoding, independent of browser and household policy.
function table(value, allowed, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) throw new Error(`Unknown ${name} fields: ${unknown.join(', ')}`);
  return value;
}
function number(value, name, min, max = Infinity, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER || (integer && !Number.isSafeInteger(value))) throw new Error(`${name} must be a safe finite ${integer ? 'integer' : 'number'}`);
  if (value < min || value > max) throw new Error(`${name} is out of range`);
  return value;
}
export function buildSearchUrl(config) {
  table(config, ['region', 'map_bounds', 'filters'], 'search');
  if (!('region' in config) && !('map_bounds' in config)) throw new Error('Specify region or map_bounds');
  const state = { isMapVisible: true, isListVisible: true };
  if ('region' in config) {
    const region = table(config.region, ['id', 'type'], 'region');
    state.regionSelection = [{ regionId: number(region.id, 'region.id', 1, Infinity, true), regionType: number(region.type, 'region.type', 1, Infinity, true) }];
  }
  if ('map_bounds' in config) {
    const bounds = table(config.map_bounds, ['west', 'east', 'south', 'north'], 'map_bounds');
    for (const key of ['west', 'east', 'south', 'north']) number(bounds[key], `map_bounds.${key}`, key === 'west' || key === 'east' ? -180 : -90, key === 'west' || key === 'east' ? 180 : 90);
    if (bounds.west >= bounds.east || bounds.south >= bounds.north) throw new Error('map_bounds requires west < east and south < north');
    state.mapBounds = { ...bounds };
  }
  const filters = table(config.filters ?? {}, ['max_rent', 'min_bedrooms', 'min_bathrooms', 'cats_allowed', 'in_unit_laundry', 'listing_age_days', 'availability_date'], 'filters');
  const result = Object.fromEntries(['isForSaleByAgent', 'isForSaleByOwner', 'isNewConstruction', 'isComingSoon', 'isAuction', 'isForSaleForeclosure'].map(key => [key, { value: false }]));
  result.isForRent = { value: true };
  for (const [key, target, bound, min, integer] of [['max_rent', 'monthlyPayment', 'max', 1, true], ['min_bedrooms', 'beds', 'min', 0, true], ['min_bathrooms', 'baths', 'min', 0, false]]) {
    if (key in filters) result[target] = { [bound]: number(filters[key], `filters.${key}`, min, Infinity, integer) };
  }
  for (const [key, target] of [['cats_allowed', 'onlyRentalCatsAllowed'], ['in_unit_laundry', 'onlyRentalInUnitLaundry']]) {
    if (key in filters) {
      if (typeof filters[key] !== 'boolean') throw new Error(`filters.${key} must be boolean`);
      result[target] = { value: filters[key] };
    }
  }
  if ('listing_age_days' in filters) {
    if (![1, 7, 14, 30, 90].includes(filters.listing_age_days)) throw new Error('listing_age_days must be one of 1, 7, 14, 30, 90');
    result.doz = { value: String(filters.listing_age_days) };
  }
  if ('availability_date' in filters) {
    const date = filters.availability_date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('availability_date must be a valid YYYY-MM-DD string');
    result.onlyRentalRequestedAvailabilityDate = { value: date };
  }
  state.filterState = result;
  return `https://www.zillow.com/homes/for_rent/?${new URLSearchParams({ searchQueryState: JSON.stringify(state) })}`;
}

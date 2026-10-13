// Rental-search URL encoding, independent of browser and household policy.
const CONFIG_FIELDS = ['region', 'map_bounds', 'filters'];
const FILTER_FIELDS = [
  'max_rent',
  'min_bedrooms',
  'min_bathrooms',
  'cats_allowed',
  'in_unit_laundry',
  'listing_age_days',
  'availability_date',
];
const LISTING_AGES = [1, 7, 14, 30, 90];

function requireObjectFields(value, allowedFields, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }

  const unknownFields = Object.keys(value).filter(key => !allowedFields.includes(key));
  if (unknownFields.length) {
    throw new Error(`Unknown ${name} fields: ${unknownFields.join(', ')}`);
  }
  return value;
}

function requireNumber(value, name, { minimum, maximum = Infinity, integer = false }) {
  const safeNumber = typeof value === 'number'
    && Number.isFinite(value)
    && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
  if (!safeNumber || (integer && !Number.isSafeInteger(value))) {
    throw new Error(`${name} must be a safe finite ${integer ? 'integer' : 'number'}`);
  }
  if (value < minimum || value > maximum) {
    throw new Error(`${name} is out of range`);
  }
  return value;
}

function encodeRegion(value) {
  const region = requireObjectFields(value, ['id', 'type'], 'region');
  return [{
    regionId: requireNumber(region.id, 'region.id', { minimum: 1, integer: true }),
    regionType: requireNumber(region.type, 'region.type', { minimum: 1, integer: true }),
  }];
}

function encodeMapBounds(value) {
  const bounds = requireObjectFields(value, ['west', 'east', 'south', 'north'], 'map_bounds');
  const coordinateRanges = {
    west: { minimum: -180, maximum: 180 },
    east: { minimum: -180, maximum: 180 },
    south: { minimum: -90, maximum: 90 },
    north: { minimum: -90, maximum: 90 },
  };
  for (const [coordinate, range] of Object.entries(coordinateRanges)) {
    requireNumber(bounds[coordinate], `map_bounds.${coordinate}`, range);
  }
  if (bounds.west >= bounds.east || bounds.south >= bounds.north) {
    throw new Error('map_bounds requires west < east and south < north');
  }
  return { ...bounds };
}

function requireBoolean(value, name) {
  if (typeof value !== 'boolean') throw new Error(`${name} must be boolean`);
  return value;
}

function requireAvailabilityDate(value) {
  const dateShape = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!dateShape || !Number.isFinite(Date.parse(value))) {
    throw new Error('availability_date must be a valid YYYY-MM-DD string');
  }
  // Date.parse normalizes impossible calendar dates such as February 30.
  if (new Date(value).toISOString().slice(0, 10) !== value) {
    throw new Error('availability_date must be a valid YYYY-MM-DD string');
  }
  return value;
}

function encodeFilters(value) {
  const filters = requireObjectFields(value, FILTER_FIELDS, 'filters');
  const encoded = {
    isForSaleByAgent: { value: false },
    isForSaleByOwner: { value: false },
    isNewConstruction: { value: false },
    isComingSoon: { value: false },
    isAuction: { value: false },
    isForSaleForeclosure: { value: false },
    isForRent: { value: true },
  };

  if ('max_rent' in filters) {
    encoded.monthlyPayment = {
      max: requireNumber(filters.max_rent, 'filters.max_rent', { minimum: 1, integer: true }),
    };
  }
  if ('min_bedrooms' in filters) {
    encoded.beds = {
      min: requireNumber(filters.min_bedrooms, 'filters.min_bedrooms', { minimum: 0, integer: true }),
    };
  }
  if ('min_bathrooms' in filters) {
    encoded.baths = {
      min: requireNumber(filters.min_bathrooms, 'filters.min_bathrooms', { minimum: 0 }),
    };
  }
  if ('cats_allowed' in filters) {
    encoded.onlyRentalCatsAllowed = {
      value: requireBoolean(filters.cats_allowed, 'filters.cats_allowed'),
    };
  }
  if ('in_unit_laundry' in filters) {
    encoded.onlyRentalInUnitLaundry = {
      value: requireBoolean(filters.in_unit_laundry, 'filters.in_unit_laundry'),
    };
  }
  if ('listing_age_days' in filters) {
    if (!LISTING_AGES.includes(filters.listing_age_days)) {
      throw new Error('listing_age_days must be one of 1, 7, 14, 30, 90');
    }
    encoded.doz = { value: String(filters.listing_age_days) };
  }
  if ('availability_date' in filters) {
    encoded.onlyRentalRequestedAvailabilityDate = {
      value: requireAvailabilityDate(filters.availability_date),
    };
  }
  return encoded;
}

export function buildSearchUrl(config) {
  requireObjectFields(config, CONFIG_FIELDS, 'search');
  if (!('region' in config) && !('map_bounds' in config)) {
    throw new Error('Specify region or map_bounds');
  }

  const state = { isMapVisible: true, isListVisible: true };
  if ('region' in config) state.regionSelection = encodeRegion(config.region);
  if ('map_bounds' in config) state.mapBounds = encodeMapBounds(config.map_bounds);
  state.filterState = encodeFilters(config.filters ?? {});

  const parameters = new URLSearchParams({ searchQueryState: JSON.stringify(state) });
  return `https://www.zillow.com/homes/for_rent/?${parameters}`;
}

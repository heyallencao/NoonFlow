export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface WttrResponse {
  current_condition?: Array<{
    temp_C?: string;
    weatherDesc?: Array<{ value?: string }>;
  }>;
  nearest_area?: Array<{
    areaName?: Array<{ value?: string }>;
  }>;
}

interface IpApiResponse {
  status?: string;
  countryCode?: string;
  regionName?: string;
  city?: string;
}

interface QqWeatherResponse {
  status?: number;
  data?: {
    observe?: {
      degree?: string;
      weather?: string;
    };
  };
}

function normalizeCnLocationName(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  return value.replace(/\s+/g, '').trim();
}

async function fetchQqWeatherByIp() {
  const geoResponse = await fetch('http://ip-api.com/json/?lang=zh-CN', {
    cache: 'no-store',
  });
  if (!geoResponse.ok) {
    throw new Error(`ip-api failed: ${geoResponse.status}`);
  }

  const geo = (await geoResponse.json()) as IpApiResponse;
  if (geo.status !== 'success' || geo.countryCode !== 'CN') {
    throw new Error('ip location not in China');
  }

  const province = normalizeCnLocationName(geo.regionName);
  const city = normalizeCnLocationName(geo.city);
  if (!province || !city) {
    throw new Error('missing cn province/city');
  }

  const weatherUrl = `https://wis.qq.com/weather/common?source=pc&weather_type=observe&province=${encodeURIComponent(province)}&city=${encodeURIComponent(city)}&county=${encodeURIComponent(city)}`;
  const weatherResponse = await fetch(weatherUrl, {
    cache: 'no-store',
  });
  if (!weatherResponse.ok) {
    throw new Error(`qq weather failed: ${weatherResponse.status}`);
  }

  const payload = (await weatherResponse.json()) as QqWeatherResponse;
  const degreeText = payload.data?.observe?.degree ?? '';
  const weatherText = payload.data?.observe?.weather ?? '';
  if (!degreeText && !weatherText) {
    throw new Error('qq weather empty payload');
  }

  const parsedTemp = Number(degreeText);

  return {
    location: city,
    temperatureC: Number.isFinite(parsedTemp) ? parsedTemp : null,
    description: weatherText || null,
  };
}

async function fetchWttrWeather() {
  const response = await fetch('https://wttr.in/?format=j1', {
    headers: {
      'User-Agent': 'NoonFlow/dashboard-weather',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`weather upstream failed: ${response.status}`);
  }

  const payload = (await response.json()) as WttrResponse;
  const current = payload.current_condition?.[0];
  const nearestArea = payload.nearest_area?.[0]?.areaName?.[0]?.value ?? null;
  const temperatureC = current?.temp_C ? Number(current.temp_C) : null;
  const description = current?.weatherDesc?.[0]?.value ?? null;

  return {
    location: nearestArea,
    temperatureC: Number.isFinite(temperatureC) ? temperatureC : null,
    description,
  };
}

export async function GET() {
  try {
    try {
      const qqWeather = await fetchQqWeatherByIp();
      return Response.json(qqWeather);
    } catch (qqError) {
      console.warn('[dashboard/weather] qq weather fallback:', qqError);
    }

    const wttrWeather = await fetchWttrWeather();
    return Response.json(wttrWeather);
  } catch (error) {
    console.error('[dashboard/weather] Error:', error);
    return Response.json(
      {
        location: null,
        temperatureC: null,
        description: null,
      },
      { status: 200 },
    );
  }
}

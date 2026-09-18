export interface Channel {
  uid: string;
  name: string;
  number: string | null;
  logo: number | null;
  normalLogo: number | null;
  resolution: string | null;
  catchup: boolean;
  catchupHours: number | null;
  category: string | null;
}

export interface Category {
  uid: string;
  name: string;
  desc: string;
  total: number;
}

export interface VodItem {
  uid: string;
  title: string;
  type: "movie" | "series";
  year: number | null;
  duration: number | null;
  poster: number | null;
  category: string | null;
}

export interface CategoryDetail {
  uid: string;
  name: string;
  desc: string;
  movies: number;
  series: number;
  items: VodItem[];
}

export interface EpgProgram {
  start: string;
  end: string;
  title: string;
  desc: string;
  img: number | null;
}

export interface EpgNow {
  now: EpgProgram | null;
  next: EpgProgram | null;
}

export interface MovieDetail {
  uid: string;
  title: string;
  year: number | null;
  duration: number | null;
  rating: number | null;
  resolution: string | null;
  country: string[];
  description: string;
  director: string | null;
  cast: string | null;
  poster: number | null;
  titleArt: number | null;
  hasTrailer: boolean;
  category: string | null;
}

export interface SeriesDetail {
  uid: string;
  title: string;
  year: number | null;
  description: string;
  cast: string | null;
  poster: number | null;
  category: string | null;
  total: number;
  episodes: SeriesEpisode[];
}

export interface SeriesEpisode {
  uid: string;
  season: number;
  number: number;
  title: string;
  duration: number | null;
  thumb: number | null;
}

export interface StreamToken {
  url: string;
  license: string;
  licenseWv?: string;
  licenseFp?: string;
  licenseExpires: number;
  streamExpires: number;
  isLive: boolean;
}

export interface SessionPayload {
  deviceUid: string;
  mobileNumber: string | null;
  signedIn: boolean;
  iat: number;
  exp: number;
}

export interface DeviceInfo {
  deviceUid: string;
  deviceClass: string;
  deviceOS: string;
  loginType: string;
  deviceType: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface TokenRecord {
  deviceUid: string;
  mobileNumber: string | null;
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: string;
  expires_at: number;
  refresh_expires_at: number | null;
  user_id: number;
  device_id: number;
  operator_name: string;
  operator_uid: string;
  is_blocked: boolean;
  is_multicast_network: boolean;
  subscriber_tags: string[];
  captured_at: string;
}

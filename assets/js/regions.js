/**
 * 전 지구 빙하 지역 — RGI(Randolph Glacier Inventory) 1차 지역 19개
 *
 * area: RGI 6.0 인벤토리의 빙하 면적(km²) 근삿값. 실시간 값이 아니라 정적 참고치입니다.
 * point: 그 지역을 대표하는 빙하 지점의 좌표와 고도. ERA5 재분석 기온을 이
 *        고도로 내려 맞춰 지역의 융해 조건을 계산합니다.
 *        지역 전체를 대표하는 한 점이므로, 지역 내 편차는 담지 못합니다.
 */
export const RGI_REGIONS = [
  { id: '01', name: '알래스카', en: 'Alaska', area: 86700,
    lat: 60.9, lon: -144.0, elev: 1500, ref: '베글리 아이스필드' },
  { id: '02', name: '캐나다 서부 · 미국', en: 'Western Canada & USA', area: 14500,
    lat: 52.2, lon: -117.2, elev: 2500, ref: '컬럼비아 아이스필드' },
  { id: '03', name: '캐나다 북극 북부', en: 'Arctic Canada North', area: 105000,
    lat: 79.0, lon: -83.0, elev: 900, ref: '엘즈미어섬' },
  { id: '04', name: '캐나다 북극 남부', en: 'Arctic Canada South', area: 40900,
    lat: 69.8, lon: -72.5, elev: 900, ref: '배핀섬 반스 빙모' },
  { id: '05', name: '그린란드 주변부', en: 'Greenland Periphery', area: 89700,
    lat: 68.0, lon: -50.5, elev: 1100, ref: '서그린란드 주변 빙하' },
  { id: '06', name: '아이슬란드', en: 'Iceland', area: 11060,
    lat: 64.4, lon: -16.8, elev: 1200, ref: '바트나이외쿠틀' },
  { id: '07', name: '스발바르', en: 'Svalbard & Jan Mayen', area: 33960,
    lat: 79.7, lon: 24.0, elev: 700, ref: '아우스트폰나' },
  { id: '08', name: '스칸디나비아', en: 'Scandinavia', area: 2950,
    lat: 61.7, lon: 7.0, elev: 1500, ref: '요스테달스브레엔' },
  { id: '09', name: '러시아 북극', en: 'Russian Arctic', area: 51590,
    lat: 75.0, lon: 61.0, elev: 700, ref: '노바야제믈랴' },
  { id: '10', name: '북아시아', en: 'North Asia', area: 2410,
    lat: 50.0, lon: 87.7, elev: 3000, ref: '알타이 · 사얀' },
  { id: '11', name: '중부 유럽 (알프스)', en: 'Central Europe', area: 2090,
    lat: 46.5, lon: 8.05, elev: 3000, ref: '알레치 빙하' },
  { id: '12', name: '캅카스 · 중동', en: 'Caucasus & Middle East', area: 1310,
    lat: 43.35, lon: 42.44, elev: 3800, ref: '엘브루스' },
  { id: '13', name: '중앙아시아', en: 'Central Asia', area: 49300,
    lat: 42.2, lon: 80.2, elev: 4000, ref: '톈산 이닐첵' },
  { id: '14', name: '남아시아 서부', en: 'South Asia West', area: 33570,
    lat: 35.7, lon: 76.4, elev: 4500, ref: '카라코람 발토로' },
  { id: '15', name: '남아시아 동부 (히말라야)', en: 'South Asia East', area: 14730,
    lat: 28.0, lon: 86.85, elev: 5300, ref: '쿰부 빙하 · 에베레스트' },
  { id: '16', name: '저위도 (열대 안데스)', en: 'Low Latitudes', area: 2340,
    lat: -9.12, lon: -77.6, elev: 5000, ref: '코르디예라 블랑카 · 페루' },
  { id: '17', name: '남부 안데스', en: 'Southern Andes', area: 29430,
    lat: -49.9, lon: -73.3, elev: 1500, ref: '파타고니아 웁살라 빙하' },
  { id: '18', name: '뉴질랜드', en: 'New Zealand', area: 1160,
    lat: -43.6, lon: 170.2, elev: 2000, ref: '태즈먼 빙하' },
  { id: '19', name: '남극 주변부', en: 'Antarctic & Subantarctic', area: 132870,
    lat: -65.0, lon: -62.5, elev: 500, ref: '남극 반도' },
];

export const TOTAL_GLACIER_AREA = RGI_REGIONS.reduce((s, r) => s + r.area, 0);

/**
 * 전 지구 빙하 질량 손실 — 공표된 연구 결과에서 가져온 정적 참고치입니다.
 * 이 대시보드가 계산한 값이 아니며, 실시간으로 갱신되지 않습니다.
 */
export const MASS_LOSS_FACTS = [
  {
    value: '약 267 Gt',
    unit: '/ 년',
    label: '전 지구 빙하 질량 손실 (2000~2019 평균)',
    note: 'Hugonnet et al. 2021, Nature — 위성 고도 측정 기반. 빙상(그린란드·남극 본체)은 제외한 산악 빙하 기준',
  },
  {
    value: '약 706,000',
    unit: 'km²',
    label: '전 지구 빙하 면적 (빙상 제외)',
    note: 'RGI 6.0 인벤토리. 21만 개가 넘는 빙하의 합계',
  },
  {
    value: '해수면 +',
    unit: '기여',
    label: '빙하 융해는 해수면 상승의 주요 원인',
    note: 'IPCC AR6 — 20세기 후반 이후 해수면 상승에서 산악 빙하 융해가 열팽창과 함께 큰 몫을 차지',
  },
];

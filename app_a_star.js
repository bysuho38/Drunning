// 지도 변수 선언 (나중에 초기화)
let map = null;

// 지도 초기화 함수 (메인 컨텐츠가 표시될 때 호출)
function initMainMap() {
    if (map) {
        // 이미 초기화되어 있으면 크기만 조정
        setTimeout(() => {
            map.invalidateSize();
        }, 100);
        return;
    }
    
    const mapElement = document.getElementById('map');
    if (!mapElement) {
        console.error('지도 요소를 찾을 수 없습니다.');
        return;
    }
    
    // 지도 초기화 - 전주시 중심
    map = L.map('map').setView([35.8242, 127.1480], 13);
    
    // OpenStreetMap 타일 레이어 추가
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);
    
    console.log('메인 지도 초기화 완료');
}

// 전주시 경계 좌표
const JEONJU_BOUNDS = {
    minLat: 35.75,
    minLon: 127.05,
    maxLat: 35.90,
    maxLon: 127.25
};

// 도로 데이터 로드
async function loadRoadData() {
    try {
        console.log('도로 데이터를 로드하는 중...');
        // 걸을 수 있는 도로 파일이 있으면 우선 사용, 없으면 전체 도로 파일 사용
        let filename = 'jeonju_walkable_roads.json';
        let response = await fetch(filename);
        
        if (!response.ok) {
            console.log('걸을 수 있는 도로 파일이 없습니다. 전체 도로 파일을 사용합니다.');
            filename = 'jeonju_roads.json';
            response = await fetch(filename);
        }
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        roadData = await response.json();
        console.log(`도로 데이터 로드 완료: ${roadData.roads.length}개의 도로 (${filename})`);
        console.log('도로 데이터 샘플:', roadData.roads[0]);
        return roadData;
    } catch (error) {
        console.error('도로 데이터 로드 오류:', error);
        console.error('오류 상세:', error.message);
        alert('도로 데이터를 로드할 수 없습니다. 웹 서버를 통해 실행해주세요.\n\nPython: python -m http.server 8000\nNode.js: npx http-server');
        return null;
    }
}

// POI 데이터 로드 (CSV 파일) - 간단한 목록만 로드
async function loadPOIData() {
    try {
        console.log('POI 목록을 로드하는 중...');
        const response = await fetch('Jeonju_POI_data.csv');
        
        if (!response.ok) {
            console.warn(`POI 파일을 찾을 수 없습니다. (HTTP ${response.status})`);
            return [];
        }
        
        const csvText = await response.text();
        const lines = csvText.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
            console.warn('POI 파일이 비어있거나 헤더만 있습니다.');
            return [];
        }
        
        // CSV 파싱 (헤더 제외)
        const pois = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            // CSV 파싱 (쉼표로 분리, 따옴표 내부 쉼표 처리)
            const parts = [];
            let current = '';
            let inQuotes = false;
            
            for (let j = 0; j < line.length; j++) {
                const char = line[j];
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    parts.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            parts.push(current.trim()); // 마지막 필드
            
            if (parts.length >= 4) {
                const name = parts[0];
                const lat = parseFloat(parts[1]);
                const lon = parseFloat(parts[2]);
                const category = parts[3];
                
                if (!isNaN(lat) && !isNaN(lon) && name && category) {
                    pois.push({
                        name: name,
                        lat: lat,
                        lon: lon,
                        category: category
                    });
                }
            }
        }
        
        poiCatalog = pois;
        console.log(`POI 목록 로드 완료: ${pois.length}개의 POI`);
        
        // 카테고리별 통계
        const categoryCount = {};
        pois.forEach(poi => {
            categoryCount[poi.category] = (categoryCount[poi.category] || 0) + 1;
        });
        console.log('POI 카테고리별 개수:', categoryCount);
        
        return pois;
    } catch (error) {
        console.error('POI 데이터 로드 오류:', error);
        console.warn('POI 기능 없이 계속 진행합니다.');
        return [];
    }
}

// 선택한 POI를 도로 노드에 매핑 (실시간)
function mapPOIToNode(poi, graph, spatialIdx = null, maxDistance = 500) {
    if (!graph || graph.size === 0) {
        console.warn('도로 그래프가 없습니다.');
        return null;
    }
    
    // 가장 가까운 도로 노드 찾기
    const nearestNodeKey = spatialIdx
        ? findNearestNodeFast(graph, spatialIdx, poi.lat, poi.lon, maxDistance / 1000)
        : findNearestNode(graph, poi.lat, poi.lon);
    
    if (!nearestNodeKey) {
        return null;
    }
    
    // 거리 확인
    const node = graph.get(nearestNodeKey);
    if (!node) {
        return null;
    }
    
    const distance = calculateDistance(poi.lat, poi.lon, node.lat, node.lon);
    if (distance > maxDistance) {
        console.warn(`POI "${poi.name}"가 너무 멀어 매핑 실패 (${distance.toFixed(0)}m)`);
        return null;
    }
    
    return {
        nodeKey: nearestNodeKey,
        distance: distance
    };
}

// 선택한 여러 POI를 노드에 매핑
function mapSelectedPOIsToNodes(pois, graph, spatialIdx = null) {
    const mappedPOIs = [];
    
    for (const poi of pois) {
        const mapping = mapPOIToNode(poi, graph, spatialIdx);
        if (mapping) {
            mappedPOIs.push({
                ...poi,
                nodeKey: mapping.nodeKey,
                distance: mapping.distance
            });
        } else {
            console.warn(`POI "${poi.name}" 매핑 실패`);
        }
    }
    
    return mappedPOIs;
}

// TSP 근사 알고리즘: Nearest Neighbor (최적화 버전)
// 시작점에서 시작하여 모든 POI를 방문하고 다시 시작점으로 돌아오는 최단 경로 찾기
function solveTSP(startNodeKey, poiNodes, graph) {
    if (poiNodes.length === 0) {
        return [startNodeKey];
    }
    
    if (poiNodes.length === 1) {
        return [startNodeKey, poiNodes[0].nodeKey, startNodeKey];
    }
    
    // 거리 행렬 미리 계산 (캐싱 활용)
    const allNodes = [startNodeKey, ...poiNodes.map(p => p.nodeKey)];
    const distanceMatrix = new Map(); // "node1,node2" -> distance
    
    // 모든 노드 쌍의 거리 미리 계산
    for (let i = 0; i < allNodes.length; i++) {
        for (let j = i + 1; j < allNodes.length; j++) {
            const node1 = allNodes[i];
            const node2 = allNodes[j];
            const pathResult = findShortestPath(graph, node1, node2, true);
            if (pathResult) {
                const key1 = `${node1},${node2}`;
                const key2 = `${node2},${node1}`;
                distanceMatrix.set(key1, pathResult.distance);
                distanceMatrix.set(key2, pathResult.distance);
            }
        }
    }
    
    // 거리 조회 헬퍼 함수
    const getDistance = (from, to) => {
        const key = `${from},${to}`;
        return distanceMatrix.get(key) || Infinity;
    };
    
    // 1. Nearest Neighbor로 초기 경로 생성 (거리 행렬 사용)
    const unvisited = [...poiNodes];
    const path = [startNodeKey];
    let currentKey = startNodeKey;
    
    while (unvisited.length > 0) {
        let nearestIdx = 0;
        let minDistance = Infinity;
        
        // 현재 위치에서 가장 가까운 POI 찾기 (거리 행렬 사용)
        for (let i = 0; i < unvisited.length; i++) {
            const poiNode = unvisited[i];
            const distance = getDistance(currentKey, poiNode.nodeKey);
            if (distance < minDistance) {
                minDistance = distance;
                nearestIdx = i;
            }
        }
        
        const nearestPOI = unvisited.splice(nearestIdx, 1)[0];
        path.push(nearestPOI.nodeKey);
        currentKey = nearestPOI.nodeKey;
    }
    
    // 시작점으로 돌아가기
    path.push(startNodeKey);
    
    return path;
}


// 스퍼(막다른 가지) 제거 알고리즘
// 앵커(시작점, 템플릿 노드, POI 노드)를 보호하면서 막다른 가지만 제거
function removeSpurs(routeNodeKeys, anchorNodes, graph, maxSpurLength = 700) {
    if (!routeNodeKeys || routeNodeKeys.length < 3) {
        return routeNodeKeys;
    }
    
    // 앵커 노드 집합 생성
    const anchorSet = new Set(anchorNodes);
    
    // 간선 사용 횟수 카운트 (양방향)
    const edgeCounts = new Map(); // "node1,node2" -> count
    
    // 경로를 순회하며 간선 카운트
    for (let i = 0; i < routeNodeKeys.length - 1; i++) {
        const from = routeNodeKeys[i];
        const to = routeNodeKeys[i + 1];
        const edgeKey = from < to ? `${from},${to}` : `${to},${from}`;
        edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) || 0) + 1);
    }
    
    // 스퍼 제거: 왕복 구간 찾기
    // 경로에서 "A -> B -> ... -> B -> A" 형태의 왕복 구간 찾기
    const removedIndices = new Set();
    
    // 간단한 방법: 연속된 왕복 간선 찾기
    for (let i = 0; i < routeNodeKeys.length - 1; i++) {
        const from = routeNodeKeys[i];
        const to = routeNodeKeys[i + 1];
        const edgeKey = from < to ? `${from},${to}` : `${to},${from}`;
        const count = edgeCounts.get(edgeKey) || 0;
        
        // 왕복 간선(2번 사용)이고, 양쪽 노드가 모두 앵커가 아니면 제거 후보
        if (count === 2 && !anchorSet.has(from) && !anchorSet.has(to)) {
            // 간선 길이 확인
            const fromNode = graph.get(from);
            const toNode = graph.get(to);
            if (fromNode && toNode) {
                const edgeLength = calculateDistance(fromNode.lat, fromNode.lon, toNode.lat, toNode.lon);
                
                // 스퍼 길이 제한 내이고, 왕복 구간이면 제거
                if (edgeLength <= maxSpurLength) {
                    // 이 간선이 실제로 왕복으로 사용되는지 확인
                    // 앞뒤로 같은 간선이 연속으로 나타나는지 확인
                    let foundRoundTrip = false;
                    
                    // 앞으로 검색: from -> to
                    for (let j = Math.max(0, i - 10); j < i; j++) {
                        if (routeNodeKeys[j] === to && routeNodeKeys[j + 1] === from) {
                            foundRoundTrip = true;
                            break;
                        }
                    }
                    
                    // 뒤로 검색: to -> from
                    if (!foundRoundTrip) {
                        for (let j = i + 1; j < Math.min(routeNodeKeys.length - 1, i + 11); j++) {
                            if (routeNodeKeys[j] === to && routeNodeKeys[j + 1] === from) {
                                foundRoundTrip = true;
                                break;
                            }
                        }
                    }
                    
                    // 왕복 구간이면 제거 표시
                    if (foundRoundTrip) {
                        removedIndices.add(i);
                    }
                }
            }
        }
    }
    
    // 제거된 간선이 없으면 원본 반환
    if (removedIndices.size === 0) {
        return routeNodeKeys;
    }
    
    // 경로 재구성: 제거된 간선을 건너뛰고 경로를 다시 연결
    const cleanedRoute = [];
    let i = 0;
    
    while (i < routeNodeKeys.length) {
        // 제거된 간선이 아니면 노드 추가
        if (!removedIndices.has(i)) {
            const nodeKey = routeNodeKeys[i];
            // 중복 제거
            if (cleanedRoute.length === 0 || cleanedRoute[cleanedRoute.length - 1] !== nodeKey) {
                cleanedRoute.push(nodeKey);
            }
            i++;
        } else {
            // 제거된 간선이면: 스퍼 구간 건너뛰기
            // 제거된 간선의 시작점은 이미 추가되었으므로, 끝점만 찾아서 연결
            const spurStart = routeNodeKeys[i];
            let spurEnd = null;
            
            // 연속된 제거된 간선 찾기 (스퍼 구간 전체 찾기)
            while (i < routeNodeKeys.length - 1 && removedIndices.has(i)) {
                i++;
                spurEnd = routeNodeKeys[i];
            }
            
            // 스퍼 구간을 건너뛰고, 스퍼 시작점과 끝점을 연결
            // 스퍼 시작점은 이미 cleanedRoute에 있으므로, 끝점만 추가
            if (spurEnd && cleanedRoute.length > 0) {
                const lastNode = cleanedRoute[cleanedRoute.length - 1];
                
                // 스퍼 시작점과 끝점이 다르고, 연결이 끊어지지 않았으면 끝점 추가
                if (lastNode === spurStart && spurEnd !== spurStart) {
                    // 중복 제거
                    if (cleanedRoute[cleanedRoute.length - 1] !== spurEnd) {
                        cleanedRoute.push(spurEnd);
                    }
                }
            }
            
            i++;
        }
    }
    
    // 시작점 보장
    if (cleanedRoute.length > 0 && routeNodeKeys[0] && cleanedRoute[0] !== routeNodeKeys[0]) {
        cleanedRoute.unshift(routeNodeKeys[0]);
    }
    
    // 마지막 노드 보장 (시작점으로 돌아오는 경우)
    if (cleanedRoute.length > 0 && routeNodeKeys[routeNodeKeys.length - 1] === routeNodeKeys[0]) {
        if (cleanedRoute[cleanedRoute.length - 1] !== routeNodeKeys[0]) {
            cleanedRoute.push(routeNodeKeys[0]);
        }
    }
    
    // 스퍼 제거 후 경로가 끊어졌는지 확인하고, 끊어진 부분을 A*로 다시 연결
    const finalRoute = [];
    for (let i = 0; i < cleanedRoute.length - 1; i++) {
        const from = cleanedRoute[i];
        const to = cleanedRoute[i + 1];
        
        finalRoute.push(from);
        
        // 연속된 노드가 아니면 A*로 경로 찾기
        const fromNode = graph.get(from);
        const toNode = graph.get(to);
        
        if (fromNode && toNode) {
            // 직접 연결되어 있는지 확인 (인접 노드인지)
            const isAdjacent = fromNode.neighbors && fromNode.neighbors.some(n => n.node === to);
            
            if (!isAdjacent) {
                // 직접 연결되지 않았으면 A*로 경로 찾기
                const pathResult = findShortestPath(graph, from, to, true);
                if (pathResult && pathResult.path && pathResult.path.length > 2) {
                    // 중간 경로 추가 (시작점과 끝점 제외)
                    finalRoute.push(...pathResult.path.slice(1, -1));
                }
            }
        }
    }
    
    // 마지막 노드 추가
    if (cleanedRoute.length > 0) {
        finalRoute.push(cleanedRoute[cleanedRoute.length - 1]);
    }
    
    return finalRoute.length > 0 ? finalRoute : routeNodeKeys;
}


// 템플릿 노드와 POI 노드를 결합하여 경로 생성
// 템플릿 포인트를 지나면서 POI도 방문하도록 경로 생성 (최적화 버전)
function combineTemplateAndPOINodes(templateNodes, poiPath, graph) {
    // poiPath는 [startNode, poi1, poi2, ..., startNode] 형태
    // templateNodes는 [startNode, template1, template2, ..., startNode] 형태
    
    if (!poiPath || poiPath.length < 3) {
        // POI가 없거나 시작점만 있으면 템플릿 노드만 반환
        return templateNodes;
    }
    
    const poiNodeSet = new Set(poiPath.slice(1, -1)); // 시작점과 끝점 제외한 POI 노드들
    if (poiNodeSet.size === 0) {
        return templateNodes;
    }
    
    const combinedNodes = [templateNodes[0]]; // 시작점으로 시작
    
    // 각 템플릿 노드 구간에서 POI를 삽입 (간소화: 최대 우회 거리 증가 및 최적화)
    for (let i = 0; i < templateNodes.length - 1; i++) {
        const currentTemplateNode = templateNodes[i];
        const nextTemplateNode = templateNodes[i + 1];
        
        // 현재 템플릿 노드 추가
        if (combinedNodes[combinedNodes.length - 1] !== currentTemplateNode) {
            combinedNodes.push(currentTemplateNode);
        }
        
        // 직접 경로 확인 (캐시 활용)
        const directPath = findShortestPath(graph, currentTemplateNode, nextTemplateNode, true);
        if (!directPath) {
            // 경로가 없으면 다음 템플릿 노드로 넘어감
            continue;
        }
        
        // 현재 구간에서 방문하지 않은 POI 중 가장 적은 우회로 삽입 가능한 것 찾기
        let bestPOI = null;
        let minDetour = Infinity;
        let minDistanceToPOI = Infinity;
        
        for (const poiNodeKey of poiNodeSet) {
            // 현재 템플릿 노드에서 POI까지의 거리 (캐시 활용)
            const pathToPOI = findShortestPath(graph, currentTemplateNode, poiNodeKey, true);
            if (!pathToPOI) continue;
            
            // POI에서 다음 템플릿 노드까지의 거리 (캐시 활용)
            const pathFromPOI = findShortestPath(graph, poiNodeKey, nextTemplateNode, true);
            if (!pathFromPOI) continue;
            
            // 우회 거리 계산
            const detour = (pathToPOI.distance + pathFromPOI.distance) - directPath.distance;
            
            // 우회가 1000m 이내이고 가장 적은 우회인 POI 선택 (기존 500m에서 증가)
            if (detour < 1000 && detour < minDetour) {
                minDetour = detour;
                minDistanceToPOI = pathToPOI.distance;
                bestPOI = poiNodeKey;
            } else if (detour < 1000 && detour === minDetour && pathToPOI.distance < minDistanceToPOI) {
                // 우회가 같으면 더 가까운 POI 선택
                minDistanceToPOI = pathToPOI.distance;
                bestPOI = poiNodeKey;
            }
        }
        
        // 최적의 POI가 있으면 추가
        if (bestPOI) {
            combinedNodes.push(bestPOI);
            poiNodeSet.delete(bestPOI); // 방문한 POI 제거
        }
    }
    
    // 마지막 템플릿 노드 추가
    if (combinedNodes[combinedNodes.length - 1] !== templateNodes[templateNodes.length - 1]) {
        combinedNodes.push(templateNodes[templateNodes.length - 1]);
    }
    
    // 아직 방문하지 않은 POI가 있으면 간단하게 TSP 순서대로 끝부분에 추가
    // (너무 많은 경로 탐색을 피하기 위해 단순화)
    if (poiNodeSet.size > 0) {
        const remainingPOIs = poiPath.slice(1, -1).filter(node => poiNodeSet.has(node));
        // 남은 POI들을 경로 끝부분에 순서대로 추가 (최적화를 위해 간단하게)
        for (const remainingPOI of remainingPOIs) {
            combinedNodes.splice(combinedNodes.length - 1, 0, remainingPOI); // 시작점 직전에 삽입
        }
    }
    
    // 경로가 유효한지 확인 (중복 제거)
    const cleanedNodes = [];
    for (let i = 0; i < combinedNodes.length; i++) {
        if (i === 0 || combinedNodes[i] !== combinedNodes[i - 1]) {
            cleanedNodes.push(combinedNodes[i]);
        }
    }
    
    return cleanedNodes;
}


// 현재 선택된 모양
let selectedShape = 'square';
let generatedRoute = null;
let routeLayers = [];
let roadData = null; // 로드된 도로 데이터
let roadGraph = null; // 도로 네트워크 그래프
let pathCache = new Map(); // 경로 캐시: "startKey-endKey" -> pathResult
let candidateRoutes = []; // 상위 후보 경로들
let poiCatalog = null; // POI 목록 (표시용): [{name, lat, lon, category}]
let selectedPOIs = []; // 사용자가 선택한 POI들
let selectedStartPoint = null; // 사용자가 선택한 시작점 {lat, lon}
let startPointMarker = null; // 시작점 마커
let isSelectingStartPoint = false; // 시작점 선택 모드
// 기본 거리 범위: 5~10km (자동 재시도 시 10~20km로 확장)
const DEFAULT_LENGTH_RANGE = { min: 5000, max: 10000 };
const FALLBACK_LENGTH_RANGE = { min: 10000, max: 20000 };
let poiMarkers = new Map(); // POI 마커 맵: "name,lat,lon" -> {marker, poi, isSelected}
let poiMarkerLayer = null; // POI 마커 레이어 그룹
let isPOISelectionMode = false; // POI 선택 모드

// POI 선택 화면용 지도 및 마커 관리
let poiSelectMap = null; // POI 선택 화면용 지도
let poiSelectMarkers = new Map(); // POI 선택 화면의 마커 맵: "name,lat,lon" -> {marker, poi}
let currentPOICategory = 'all'; // 현재 선택된 POI 카테고리

// 시작 위치 선택 화면용 지도 및 마커 관리
let startLocationMap = null; // 시작 위치 선택 화면용 지도
let startLocationMarkers = new Map(); // 선택된 POI 마커 맵
let userLocationMarker = null; // 사용자 현재 위치 마커
let selectedStartLocationMarker = null; // 선택된 시작 위치 마커
let selectedStartLocation = null; // 선택된 시작 위치 {lat, lon}
let userLocation = null; // 사용자 현재 위치 {lat, lon}

// POI 카테고리별 색상 정의
const POI_CATEGORY_COLORS = {
    '관광명소': '#FF0000', // 빨강
    '공원': '#00FF00',     // 초록
    '박물관': '#FFA500',   // 주황
    '도서관': '#00CED1',   // 하늘색
    '음식점': '#800080',   // 보라색
    '카페': '#000000',     // 검은색
    '국가유산': '#FFFF00'  // 노랑
};

// POI 카테고리 매핑 설정 (수정 가능)
// 각 선택지(카테고리 버튼)에 포함될 실제 POI 카테고리들을 정의
const POI_CATEGORY_MAPPING = {
    'all': { // 모든 장소보기
        name: '모든 장소보기',
        categories: ['관광명소', '공원', '박물관', '도서관', '음식점', '카페', '국가유산']
    },
    'historical': { // 역사적 장소
        name: '역사적 장소',
        categories: ['관광명소', '국가유산']
    },
    'cultural': { // 문화공간
        name: '문화공간',
        categories: ['공원', '박물관', '도서관']
    },
    'food': { // 맛집/카페
        name: '맛집/카페',
        categories: ['음식점', '카페']
    }
};

// 도로 가중치 패널티 설정
// 이 값을 조정하여 대로(큰 길) 회피 정도를 조절할 수 있습니다.
// 가중치 1.0 = 패널티 0, 가중치 4.0 = 패널티 (4.0-1.0) * ROAD_WEIGHT_PENALTY_MULTIPLIER 미터
// 현재 설정: 20 → 가중치 4.0일 때 약 60m 패널티
// 값이 작을수록 대로를 더 많이 사용하고, 클수록 대로를 더 피합니다.
const ROAD_WEIGHT_PENALTY_MULTIPLIER = 20;

// 전북대학교 구정문 좌표 (기본 시작점)
const DEFAULT_START_POINT = {
    lat: 35.8242,
    lon: 127.1480
};

// 전북대학교 신정문 좌표 (GPS 위치가 전주시 밖일 때 사용)
const JEONBUK_UNIV_NEW_GATE = {
    lat: 35.8447,
    lon: 127.1271
};

// 두 좌표 사이의 거리 계산 (미터)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // 지구 반경 (미터)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// 경로의 총 길이 계산
function calculatePathLength(coordinates) {
    let totalLength = 0;
    for (let i = 0; i < coordinates.length - 1; i++) {
        totalLength += calculateDistance(
            coordinates[i][0], coordinates[i][1],
            coordinates[i+1][0], coordinates[i+1][1]
        );
    }
    return totalLength;
}

// 템플릿과 경로 간의 형태 유사도 계산 (0~100%, 높을수록 유사)
// 개선된 알고리즘: 거리 + 방향성 + 순서 보존 + 전체 형태 일치도
function calculateTemplateSimilarity(template, routeCoordinates, templateType = 'default') {
    if (!template || template.length === 0 || !routeCoordinates || routeCoordinates.length === 0) {
        return 0;
    }
    
    const templatePoints = template.length > 0 && template[0].length === 2 
        ? template.slice(0, -1) // 마지막 포인트 제외 (첫 포인트와 동일)
        : template;
    
    // 1. 거리 기반 유사도 (기존 방식)
    let totalDistance = 0;
    for (const templatePoint of templatePoints) {
        let minDist = Infinity;
        for (const routePoint of routeCoordinates) {
            const dist = calculateDistance(
                templatePoint[0], templatePoint[1],
                routePoint[0], routePoint[1]
            );
            if (dist < minDist) {
                minDist = dist;
            }
        }
        totalDistance += minDist;
    }
    const avgDistance = totalDistance / templatePoints.length;
    const maxDistance = 500; // 500m 이상이면 유사도 0%
    const distanceSimilarity = Math.max(0, Math.min(100, 100 * (1 - avgDistance / maxDistance)));
    
    // 2. 방향성 일치도 (템플릿 세그먼트와 경로 세그먼트의 방향 비교)
    let directionMatch = 0;
    let directionCount = 0;
    
    for (let i = 0; i < templatePoints.length - 1; i++) {
        const t1 = templatePoints[i];
        const t2 = templatePoints[i + 1];
        const templateAngle = Math.atan2(t2[1] - t1[1], t2[0] - t1[0]);
        
        // 경로에서 가장 가까운 세그먼트 찾기
        let bestMatch = 0;
        let bestRouteIdx = -1;
        
        for (let j = 0; j < routeCoordinates.length - 1; j++) {
            const r1 = routeCoordinates[j];
            const r2 = routeCoordinates[j + 1];
            
            // 템플릿 세그먼트 중점과 경로 세그먼트의 거리
            const tMid = [(t1[0] + t2[0]) / 2, (t1[1] + t2[1]) / 2];
            const rMid = [(r1[0] + r2[0]) / 2, (r1[1] + r2[1]) / 2];
            const distToSegment = calculateDistance(tMid[0], tMid[1], rMid[0], rMid[1]);
            
            if (bestRouteIdx === -1 || distToSegment < bestMatch) {
                bestMatch = distToSegment;
                bestRouteIdx = j;
            }
        }
        
        if (bestRouteIdx >= 0 && bestRouteIdx < routeCoordinates.length - 1) {
            const r1 = routeCoordinates[bestRouteIdx];
            const r2 = routeCoordinates[bestRouteIdx + 1];
            const routeAngle = Math.atan2(r2[1] - r1[1], r2[0] - r1[0]);
            
            // 각도 차이 계산 (-π ~ π)
            let angleDiff = Math.abs(templateAngle - routeAngle);
            if (angleDiff > Math.PI) {
                angleDiff = 2 * Math.PI - angleDiff;
            }
            
            // 각도 차이가 작을수록 높은 점수 (0~1)
            const directionScore = 1 - (angleDiff / Math.PI);
            directionMatch += directionScore;
            directionCount++;
        }
    }
    
    const directionSimilarity = directionCount > 0 ? (directionMatch / directionCount) * 100 : 0;
    
    // 3. 순서 보존 점수 (경로가 템플릿의 순서를 얼마나 잘 따르는지)
    let orderScore = 0;
    let orderCount = 0;
    let lastRouteIdx = 0;
    
    for (let i = 0; i < templatePoints.length; i++) {
        const tPoint = templatePoints[i];
        let minDist = Infinity;
        let closestIdx = -1;
        
        // 이전에 찾은 경로 인덱스 이후부터 검색 (순서 보존)
        for (let j = lastRouteIdx; j < routeCoordinates.length; j++) {
            const rPoint = routeCoordinates[j];
            const dist = calculateDistance(tPoint[0], tPoint[1], rPoint[0], rPoint[1]);
            if (dist < minDist) {
                minDist = dist;
                closestIdx = j;
            }
        }
        
        if (closestIdx >= 0) {
            // 순서가 올바르게 진행되면 점수 증가
            if (closestIdx >= lastRouteIdx) {
                orderScore += 1;
            } else {
                // 역순이면 페널티 (하지만 완전히 0은 아님)
                orderScore += 0.3;
            }
            lastRouteIdx = closestIdx;
            orderCount++;
        }
    }
    
    const orderSimilarity = orderCount > 0 ? (orderScore / orderCount) * 100 : 0;
    
    // 4. 전체 형태 일치도 (중심, 크기, 회전 각도 고려)
    // 템플릿과 경로의 중심점 계산
    let templateCenter = [0, 0];
    let routeCenter = [0, 0];
    
    for (const tPoint of templatePoints) {
        templateCenter[0] += tPoint[0];
        templateCenter[1] += tPoint[1];
    }
    templateCenter[0] /= templatePoints.length;
    templateCenter[1] /= templatePoints.length;
    
    for (const rPoint of routeCoordinates) {
        routeCenter[0] += rPoint[0];
        routeCenter[1] += rPoint[1];
    }
    routeCenter[0] /= routeCoordinates.length;
    routeCenter[1] /= routeCoordinates.length;
    
    // 중심점 거리
    const centerDistance = calculateDistance(
        templateCenter[0], templateCenter[1],
        routeCenter[0], routeCenter[1]
    );
    const centerSimilarity = Math.max(0, 100 * (1 - centerDistance / 1000)); // 1km 이상이면 0%
    
    // 5. 가중 평균으로 최종 유사도 계산
    // 모든 템플릿 타입에 공통 적용: 방향성과 전체 형태 일치를 중요하게 평가
    const weights = {
        distance: 0.01,      // 거리 기반 유사도
        direction: 0.54,     // 방향성 일치도
        order: 0.1,        // 순서 보존 점수
        center: 0.35        // 전체 형태 일치도
    };
    
    const finalSimilarity = 
        distanceSimilarity * weights.distance +
        directionSimilarity * weights.direction +
        orderSimilarity * weights.order +
        centerSimilarity * weights.center;
    
    return Math.max(0, Math.min(100, finalSimilarity));
}


// 좌표를 문자열 키로 변환 (그래프 노드 ID)
function coordToKey(lat, lon, precision = 6) {
    return `${lat.toFixed(precision)},${lon.toFixed(precision)}`;
}

// 도로 데이터를 그래프 구조로 변환 (비동기 버전: UI 업데이트를 위해 중간중간 await)
async function buildRoadGraphAsync(updateProgress) {
    if (!roadData || !roadData.roads) {
        console.error('도로 데이터가 없습니다.');
        return null;
    }

    console.log('도로 네트워크 그래프 구축 중...');
    const graph = new Map(); // key -> {lat, lon, neighbors: [{node, distance, weight}]}
    
    const totalRoads = roadData.roads.length;
    let processedRoads = 0;

    // 도로를 그래프로 변환
    for (const road of roadData.roads) {
        if (!road.geometry || road.geometry.length < 2) {
            processedRoads++;
            continue;
        }

        const roadWeight = road.weight || 1.0; // 가중치 (기본값 1.0)

        for (let i = 0; i < road.geometry.length - 1; i++) {
            const point1 = road.geometry[i];
            const point2 = road.geometry[i + 1];

            if (!point1.lat || !point1.lon || !point2.lat || !point2.lon) continue;

            const key1 = coordToKey(point1.lat, point1.lon);
            const key2 = coordToKey(point2.lat, point2.lon);

            // 노드 추가
            if (!graph.has(key1)) {
                graph.set(key1, {
                    lat: point1.lat,
                    lon: point1.lon,
                    neighbors: []
                });
            }
            if (!graph.has(key2)) {
                graph.set(key2, {
                    lat: point2.lat,
                    lon: point2.lon,
                    neighbors: []
                });
            }

            // 거리 계산
            const distance = calculateDistance(point1.lat, point1.lon, point2.lat, point2.lon);
            
            // 가중치를 고려한 비용 (거리 + 페널티)
            // 가중치가 높을수록 페널티가 커짐 (큰길을 약간 피하도록, 하지만 너무 우회하지 않도록)
            // 패널티를 줄여서 50-100m 정도만 대로를 걸어도 괜찮도록 함
            // ⚙️ 패널티 조정: ROAD_WEIGHT_PENALTY_MULTIPLIER 상수를 수정하세요 (현재: 20)
            const penalty = (roadWeight - 1.0) * ROAD_WEIGHT_PENALTY_MULTIPLIER; // 가중치 1.0 = 페널티 0, 4.0 = 페널티 60m (기존 300m에서 감소)
            const cost = distance + penalty;

            // 양방향 엣지 추가
            const node1 = graph.get(key1);
            const node2 = graph.get(key2);

            // 중복 체크
            if (!node1.neighbors.find(n => n.node === key2)) {
                node1.neighbors.push({
                    node: key2,
                    distance: distance,
                    cost: cost,
                    weight: roadWeight
                });
            }
            if (!node2.neighbors.find(n => n.node === key1)) {
                node2.neighbors.push({
                    node: key1,
                    distance: distance,
                    cost: cost,
                    weight: roadWeight
                });
            }
        }
        
        processedRoads++;
        
        // 100개 도로마다 UI 업데이트
        if (updateProgress && processedRoads % 100 === 0) {
            const progress = Math.floor((processedRoads / totalRoads) * 100);
            updateProgress(`② 도로 네트워크 구축 중... ${progress}% (${processedRoads}/${totalRoads})`);
            // 브라우저가 UI를 업데이트할 시간을 줍니다
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    console.log(`그래프 구축 완료: ${graph.size}개 노드`);
    return graph;
}

// 공간 인덱스 (그리드 기반) - 빠른 근접 노드 검색을 위해
let spatialIndex = null;
let spatialGridSize = 0.01; // 약 1km 격자 크기

// 공간 인덱스 구축
function buildSpatialIndex(graph) {
    if (!graph || graph.size === 0) return null;
    
    const index = new Map(); // "lat_grid,lon_grid" -> [nodeKeys]
    
    // 모든 노드를 그리드에 배치
    for (const [key, node] of graph.entries()) {
        const gridLat = Math.floor(node.lat / spatialGridSize);
        const gridLon = Math.floor(node.lon / spatialGridSize);
        const gridKey = `${gridLat},${gridLon}`;
        
        if (!index.has(gridKey)) {
            index.set(gridKey, []);
        }
        index.get(gridKey).push({ key, node });
    }
    
    console.log(`공간 인덱스 구축 완료: ${index.size}개 그리드 셀`);
    return index;
}

// 공간 인덱스를 사용한 빠른 근접 노드 검색
function findNearestNodeFast(graph, spatialIdx, targetLat, targetLon, maxSearchRadius = 0.05) {
    if (!spatialIdx) {
        // 인덱스가 없으면 기존 방법 사용
        return findNearestNode(graph, targetLat, targetLon);
    }
    
    const centerGridLat = Math.floor(targetLat / spatialGridSize);
    const centerGridLon = Math.floor(targetLon / spatialGridSize);
    
    let nearestKey = null;
    let minDistance = Infinity;
    
    // 주변 그리드 셀들을 검색 (확장 검색)
    const searchRadius = Math.ceil(maxSearchRadius / spatialGridSize);
    
    for (let dLat = -searchRadius; dLat <= searchRadius; dLat++) {
        for (let dLon = -searchRadius; dLon <= searchRadius; dLon++) {
            const gridKey = `${centerGridLat + dLat},${centerGridLon + dLon}`;
            const nodesInCell = spatialIdx.get(gridKey);
            
            if (nodesInCell) {
                for (const { key, node } of nodesInCell) {
                    const distance = calculateDistance(targetLat, targetLon, node.lat, node.lon);
                    if (distance < minDistance) {
                        minDistance = distance;
                        nearestKey = key;
                    }
                }
            }
        }
    }
    
    // 주변에서 찾지 못했으면 기존 방법 사용 (fallback)
    if (nearestKey === null) {
        return findNearestNode(graph, targetLat, targetLon);
    }
    
    return nearestKey;
}

// 그래프에서 특정 좌표에 가장 가까운 노드 찾기 (기존 방법, fallback용)
function findNearestNode(graph, targetLat, targetLon) {
    let nearestKey = null;
    let minDistance = Infinity;

    for (const [key, node] of graph.entries()) {
        const distance = calculateDistance(targetLat, targetLon, node.lat, node.lon);
        if (distance < minDistance) {
            minDistance = distance;
            nearestKey = key;
        }
    }

    return nearestKey;
}

// 템플릿 포인트에 가장 가까운 노드 찾기 (공간 인덱스 사용)
function findNearestNodeToTemplate(graph, templatePoint) {
    return findNearestNodeFast(graph, spatialIndex, templatePoint[0], templatePoint[1]);
}

// 최소 힙 (우선순위 큐) 구현 - A*용 (f값 기준)
class MinHeapAStar {
    constructor() {
        this.heap = [];
    }
    
    push(item) {
        this.heap.push(item);
        this.bubbleUp(this.heap.length - 1);
    }
    
    pop() {
        if (this.heap.length === 0) return null;
        if (this.heap.length === 1) return this.heap.pop();
        
        const min = this.heap[0];
        this.heap[0] = this.heap.pop();
        this.bubbleDown(0);
        return min;
    }
    
    isEmpty() {
        return this.heap.length === 0;
    }
    
    bubbleUp(index) {
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (this.heap[parent].f <= this.heap[index].f) break;
            [this.heap[parent], this.heap[index]] = [this.heap[index], this.heap[parent]];
            index = parent;
        }
    }
    
    bubbleDown(index) {
        while (true) {
            let smallest = index;
            const left = 2 * index + 1;
            const right = 2 * index + 2;
            
            if (left < this.heap.length && this.heap[left].f < this.heap[smallest].f) {
                smallest = left;
            }
            if (right < this.heap.length && this.heap[right].f < this.heap[smallest].f) {
                smallest = right;
            }
            
            if (smallest === index) break;
            [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
            index = smallest;
        }
    }
}

// A* 알고리즘으로 최단 경로 찾기 (가중치 고려, 캐싱 지원)
// 휴리스틱: 직선 거리(Haversine)
function findShortestPath(graph, startKey, endKey, useCache = true) {
    // 캐시 확인
    if (useCache) {
        const cacheKey = `${startKey}-${endKey}`;
        const cached = pathCache.get(cacheKey);
        if (cached) {
            return cached;
        }
    }
    
    // 같은 노드면 즉시 반환
    if (startKey === endKey) {
        const result = {
            path: [startKey],
            distance: 0,
            cost: 0
        };
        if (useCache) {
            pathCache.set(`${startKey}-${endKey}`, result);
        }
        return result;
    }
    
    // 목적지 노드 좌표 (휴리스틱 계산용)
    const endNode = graph.get(endKey);
    if (!endNode) return null;
    const endLat = endNode.lat;
    const endLon = endNode.lon;
    
    // 휴리스틱 함수 (직선 거리)
    const heuristic = (nodeKey) => {
        const node = graph.get(nodeKey);
        if (!node) return Infinity;
        return calculateDistance(node.lat, node.lon, endLat, endLon);
    };
    
    const g = new Map(); // 시작점부터의 실제 비용 (g)
    const f = new Map(); // g + 휴리스틱 (f)
    const distances = new Map(); // 실제 거리
    const previous = new Map();
    const visited = new Set();
    
    // 시작점 초기화
    const startG = 0;
    const startH = heuristic(startKey);
    g.set(startKey, startG);
    f.set(startKey, startG + startH);
    distances.set(startKey, 0);
    
    // 우선순위 큐 초기화 (f값 기준)
    const heap = new MinHeapAStar();
    heap.push({ key: startKey, f: startG + startH });
    
    while (!heap.isEmpty()) {
        const { key: currentKey } = heap.pop();
        
        // 이미 방문한 노드는 건너뛰기
        if (visited.has(currentKey)) continue;
        
        // 목적지에 도달했으면 종료
        if (currentKey === endKey) break;
        
        visited.add(currentKey);
        
        // 이웃 노드들 확인
        const currentNode = graph.get(currentKey);
        if (!currentNode) continue;
        
        for (const neighbor of currentNode.neighbors) {
            // 이미 방문한 노드는 건너뛰기
            if (visited.has(neighbor.node)) continue;
            
            const currentG = g.get(currentKey);
            if (currentG === undefined) continue; // 현재 노드의 g값이 없으면 건너뛰기
            
            const tentativeG = currentG + neighbor.cost;
            const currentDistance = distances.get(currentKey) || 0;
            const tentativeDistance = currentDistance + neighbor.distance;
            
            // 더 짧은 경로를 찾았으면 업데이트
            if (!g.has(neighbor.node) || tentativeG < g.get(neighbor.node)) {
                g.set(neighbor.node, tentativeG);
                distances.set(neighbor.node, tentativeDistance);
                previous.set(neighbor.node, currentKey);
                
                // 휴리스틱 계산 및 f값 업데이트
                const h = heuristic(neighbor.node);
                const newF = tentativeG + h;
                f.set(neighbor.node, newF);
                
                // 힙에 추가 (중복 추가되더라도 visited로 필터링됨)
                heap.push({ key: neighbor.node, f: newF });
            }
        }
    }
    
    // 경로 재구성
    // 경로가 존재하는지 확인
    if (!previous.has(endKey) && startKey !== endKey) {
        return null;
    }
    
    const path = [];
    let current = endKey;
    
    while (current !== undefined && current !== null) {
        path.unshift(current);
        const prev = previous.get(current);
        if (prev === undefined && current !== startKey) {
            return null;  // 경로 재구성 실패
        }
        current = prev;
        
        // 무한 루프 방지 (안전 장치)
        if (path.length > graph.size) {
            console.error('경로 재구성 중 무한 루프 감지');
            return null;
        }
    }
    
    if (path.length === 0 || path[0] !== startKey) {
        return null; // 경로를 찾을 수 없음
    }
    
    const result = {
        path: path,
        distance: distances.get(endKey) || Infinity,
        cost: g.get(endKey) || Infinity
    };
    
    // 캐시에 저장
    if (useCache) {
        pathCache.set(`${startKey}-${endKey}`, result);
    }
    
    return result;
}

// 빠른 근사 점수 계산 (경로 찾기 없이)
function calculateApproximateScore(template, roadGraph, spatialIdx, startNodeKey, targetLength = 10000) {
    let totalApproxDistance = 0;
    let totalApproxCost = 0;
    let allMapped = true;
    
    // 템플릿 포인트들을 도로 노드에 매핑 (경로 찾기 없이)
    for (let i = 0; i < template.length - 1; i++) {
        const templatePoint = template[i];
        const nearestNode = findNearestNodeFast(roadGraph, spatialIdx, templatePoint[0], templatePoint[1]);
        
        if (!nearestNode) {
            allMapped = false;
            break;
        }
        
        // 템플릿 포인트와 도로 노드의 직선 거리만 계산
        const node = roadGraph.get(nearestNode);
        const dist = calculateDistance(
            templatePoint[0], templatePoint[1],
            node.lat, node.lon
        );
        totalApproxDistance += dist;
        totalApproxCost += dist; // 간단한 근사
    }
    
    if (!allMapped) return Infinity; // 매핑 실패
    
    const distanceDiff = Math.abs(totalApproxDistance - targetLength);
    return totalApproxCost + distanceDiff * 0.1;
}

// 여러 정렬 후보 중 최적 경로 찾기 (최적화 버전 + 회전/반전 변형 + POI 방문)
// updateProgress: (current:number, total:number) => void  형태로 후보 진행률만 전달
async function generateRouteFromRoadNetworkOptimized(template, updateProgress = null, options = {}) {
    const {
        numCandidates = 12, // 평가할 후보 수 (기본 12개, 곡률 기반 샘플링으로 약 40개 중 선택)
        includeVariations = true, // 회전/반전 변형 포함 여부
        topNForPrecise = 10, // 근사 점수로 상위 N개만 정밀 평가
        targetLength = 10000, // 목표 길이 (기본 10km)
        poiNodes = null // POI 노드 배열 (선택 사항): [{nodeKey, name, lat, lon, category}]
    } = options;
    
    if (!roadGraph) {
        console.error('도로 네트워크 그래프가 구축되지 않았습니다.');
        return null;
    }

    // 템플릿 타입 먼저 추출 (리샘플링 파라미터 결정에 필요)
    const templateType = options.templateType || 'default';
    const startPoint = options.startPoint || DEFAULT_START_POINT;
    const centerLat = startPoint.lat;
    const centerLon = startPoint.lon;

    // 1. 템플릿을 곡률 기반 적응적으로 리샘플링 (직선은 적게, 곡선은 많이)
    // 북런의 경우 곡선 부분에 더 집중하기 위해 곡률 가중치를 높임
    let targetNumPoints = 40;
    let curvatureWeight = 2.0;
    
    if (templateType === 'book') {
        curvatureWeight = 4.0; // 곡선 부분에 더 집중
    }
    const resampledTemplate = resampleTemplateAdaptive(template, targetNumPoints, curvatureWeight);
    const numPoints = resampledTemplate.length - 1; // 마지막은 첫 포인트와 동일하므로 제외
    
    // 디버깅: 리샘플링 결과 확인
    console.log(`리샘플링 완료: 원본 ${template.length}개 포인트 → ${resampledTemplate.length}개 포인트 (유효 포인트: ${numPoints}개)`);

    // 2. 템플릿 변형 생성 (회전 × 반전) - 미리 위도/경도 변환 완료
    console.log(`[app.js] options.templateType: "${options.templateType}", 최종 templateType: "${templateType}"`);
    const variations = includeVariations
        ? generateTemplateVariations(resampledTemplate, centerLat, centerLon, templateType)
        : [{ template: resampledTemplate, rotation: 0, flip: 1, key: '0_1' }];
    
    console.log(`[app.js] 생성된 변형 개수: ${variations.length}개`);

    // 변형 정보는 generateTemplateVariations에서 출력됨

    // 3. 시작점 노드 찾기
    const startNodeKey = findNearestNodeFast(roadGraph, spatialIndex, startPoint.lat, startPoint.lon);
    if (!startNodeKey) {
        console.error('시작점 근처의 도로를 찾을 수 없습니다.');
        return null;
    }

    // 4. 정렬 후보 인덱스 선택 (각 변형 템플릿마다 동일하게 사용)
    // numCandidates 개수만큼 균등 간격으로 선택
    const candidateIndexSet = new Set();
    
    // numPoints가 충분한지 확인
    if (numPoints < 1) {
        console.error(`오류: 유효 포인트 수가 부족합니다. (${numPoints}개)`);
        return null;
    }
    
    const targetCount = Math.max(1, Math.min(numCandidates, numPoints));
    const step = Math.max(1, Math.floor(numPoints / targetCount));
    
    // 균등 간격으로 후보 선택
    for (let i = 0; candidateIndexSet.size < targetCount && i < numPoints * 2; i++) {
        const idx = (i * step) % numPoints;
        candidateIndexSet.add(idx);
        if (candidateIndexSet.size >= targetCount) break;
    }
    
    // 0번 인덱스(원래 정렬)가 포함되지 않았다면 추가
    candidateIndexSet.add(0);
    
    const candidateIndices = Array.from(candidateIndexSet).slice(0, targetCount).sort((a, b) => a - b);
    const totalCombinations = variations.length * candidateIndices.length;

    console.log(`평가할 후보 인덱스: ${candidateIndices.join(', ')} (${candidateIndices.length}개)`);
    console.log(`정밀 평가 조합: ${variations.length}개 변형 × ${candidateIndices.length}개 정렬 후보 = ${totalCombinations}개`);

    // 모든 조합을 바로 정밀 평가로 진행 (근사 계산 단계 제거)
    const allCandidates = [];
    
    for (let varIdx = 0; varIdx < variations.length; varIdx++) {
        const variation = variations[varIdx];
        
        for (let candidateIdx = 0; candidateIdx < candidateIndices.length; candidateIdx++) {
            const templateStartIdx = candidateIndices[candidateIdx];

            // 변형 템플릿을 startIdx부터 시작하도록 재정렬
            const reorderedTemplate = reorderTemplate(variation.template, templateStartIdx);
            
            // 첫 포인트를 시작점으로 평행이동
            const alignedTemplate = alignTemplateToStartPoint(reorderedTemplate, startPoint);

            allCandidates.push({
                varIdx,
                candidateIdx,
                variation,
                templateStartIdx,
                alignedTemplate
            });
        }
    }

    const topCandidatesForPrecise = allCandidates;
    console.log(`총 ${topCandidatesForPrecise.length}개 후보를 정밀 평가합니다.`);

    // POI가 있으면 TSP 경로를 미리 계산 (모든 후보에서 재사용)
    let precomputedTSPPath = null;
    if (poiNodes && poiNodes.length > 0) {
        console.log('TSP 경로 계산 중...');
        precomputedTSPPath = solveTSP(startNodeKey, poiNodes, roadGraph);
        console.log(`TSP 경로 계산 완료: ${precomputedTSPPath.length}개 노드 (시작점 + ${poiNodes.length}개 POI + 시작점)`);
    }

    // 정밀 평가 (실제 경로 찾기)
    let bestRoute = null;
    let bestScore = 0; // 유사도는 0부터 시작 (높을수록 좋음)
    const candidates = [];
    let preciseProcessedCount = 0;

    if (typeof updateProgress === 'function') {
        updateProgress(0, topCandidatesForPrecise.length, '경로 탐색');
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    for (let i = 0; i < topCandidatesForPrecise.length; i++) {
        const top = topCandidatesForPrecise[i];
        preciseProcessedCount++;

        // 진행률 업데이트
        if (typeof updateProgress === 'function') {
            updateProgress(preciseProcessedCount, topCandidatesForPrecise.length, '경로 탐색');
        }

        const alignedTemplate = top.alignedTemplate;

        // 템플릿 포인트들을 도로 노드에 매핑
        const templateNodes = [];
        for (let j = 0; j < alignedTemplate.length - 1; j++) {
            const templatePoint = alignedTemplate[j];
            const nearestNode = findNearestNodeToTemplate(roadGraph, templatePoint);
            if (nearestNode) {
                // 중복 방지
                if (templateNodes.length === 0 || templateNodes[templateNodes.length - 1] !== nearestNode) {
                    templateNodes.push(nearestNode);
                }
            }
        }
        
        // 시작점과 끝점 보장
        templateNodes[0] = startNodeKey;
        templateNodes.push(startNodeKey);

        // POI가 있으면 템플릿 노드와 POI 노드를 결합한 경로 생성
        let finalRouteNodes = [];
        if (precomputedTSPPath && precomputedTSPPath.length > 0) {
            // 미리 계산된 TSP 경로 사용
            // 템플릿 노드와 POI 노드를 결합
            // 전략: 템플릿 포인트들을 순서대로 지나가면서, 각 구간에서 가까운 POI를 방문
            finalRouteNodes = combineTemplateAndPOINodes(templateNodes, precomputedTSPPath, roadGraph);
        } else {
            // POI가 없으면 템플릿 노드만 사용
            finalRouteNodes = templateNodes;
        }

        // 경로 생성
        const routeKeys = [];
        let totalDistance = 0;
        let totalCost = 0;
        let pathFound = true;
        let failedSegmentIndex = -1;

        for (let j = 0; j < finalRouteNodes.length - 1; j++) {
            const startNode = finalRouteNodes[j];
            const endNode = finalRouteNodes[j + 1];

            const pathResult = findShortestPath(roadGraph, startNode, endNode, true);
            if (pathResult && pathResult.path) {
                if (j === 0) {
                    routeKeys.push(...pathResult.path);
                } else {
                    routeKeys.push(...pathResult.path.slice(1));
                }
                totalDistance += pathResult.distance;
                totalCost += pathResult.cost;
            } else {
                pathFound = false;
                break;
            }
        }

        if (!pathFound) {
            console.warn(`후보 ${i + 1}/${topCandidatesForPrecise.length}: 경로를 완성할 수 없음`);
            continue;
        }

        // 인접 중복 제거 (연속된 같은 노드)
        const uniqueRouteKeys = [];
        for (let j = 0; j < routeKeys.length; j++) {
            if (j === 0 || routeKeys[j] !== routeKeys[j - 1]) {
                uniqueRouteKeys.push(routeKeys[j]);
            }
        }

        // 스퍼 제거: 앵커(시작점, 템플릿 노드, POI 노드) 보호하면서 막다른 가지만 제거
        const anchorNodes = new Set();
        anchorNodes.add(startNodeKey); // 시작점
        templateNodes.forEach(node => anchorNodes.add(node)); // 템플릿 노드
        if (precomputedTSPPath && precomputedTSPPath.length > 0) {
            precomputedTSPPath.forEach(node => anchorNodes.add(node)); // POI 노드
        }
        const maxSpurLength = 300;
        const cleanedRouteKeys = removeSpurs(uniqueRouteKeys, Array.from(anchorNodes), roadGraph, maxSpurLength);

        // 좌표 변환
        const routeCoords = cleanedRouteKeys.map(key => {
            const node = roadGraph.get(key);
            return [node.lat, node.lon];
        });

        // 스퍼 제거 후 거리 재계산
        totalDistance = calculatePathLength(routeCoords);

        // 템플릿과 경로 간 형태 유사도 계산 (템플릿 타입 전달)
        const similarity = calculateTemplateSimilarity(alignedTemplate, routeCoords, templateType);
        
        // 성공 로그 출력 (UI 업데이트를 위해)
        console.log(`후보 ${i + 1}/${topCandidatesForPrecise.length}: 경로 탐색 성공 (유사도: ${similarity.toFixed(1)}%, 거리: ${(totalDistance / 1000).toFixed(2)}km)`);

        // 점수 계산 (유사도 기반으로 변경: 유사도가 높을수록 점수가 낮음)
        // 유사도를 0~1 스케일로 변환하여 거리 차이와 함께 사용
        const similarityScore = 100 - similarity; // 유사도가 높을수록 점수가 낮음
        const distanceDiff = Math.abs(totalDistance - targetLength);
        const score = similarityScore + distanceDiff * 0.01; // 유사도를 우선시

        candidates.push({
            candidateIdx: i,
            templateIndex: top.templateStartIdx,
            variation: top.variation,
            score,
            similarity, // 유사도 저장
            distance: totalDistance,
            cost: totalCost,
            coordinates: routeCoords,
            nodeKeys: cleanedRouteKeys,
            templateNodes: templateNodes,
            alignedTemplate: alignedTemplate // 템플릿도 저장 (나중에 필요할 수 있음)
        });

        // 최적 경로 업데이트 (유사도가 가장 높은 것으로)
        if (similarity > bestScore || (similarity === bestScore && score < (bestRoute ? bestRoute.score : Infinity))) {
            bestScore = similarity;
            bestRoute = {
                coordinates: routeCoords,
                distance: totalDistance,
                nodeKeys: cleanedRouteKeys,
                templateNodes: templateNodes,
                candidateIndex: top.templateStartIdx,
                variation: top.variation,
                similarity: similarity,
                score: score
            };
        }

        // UI 업데이트를 위한 작은 지연 (매번 실행하여 로그 출력 후 UI 업데이트)
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    console.log(`후보 평가 완료: ${topCandidatesForPrecise.length}개 후보 정밀 평가 → 상위 10개 선별`);
    console.log(`변형 수: ${variations.length}개, 정렬 후보: ${candidateIndices.length}개`);
    console.log(`최적 경로: ${bestRoute ? (bestRoute.distance / 1000).toFixed(2) + 'km' : '없음'}`);

    // 유사도 기준으로 정렬 (유사도가 높은 순으로, 유사도가 같으면 거리 차이가 작은 순)
    const sorted = candidates.sort((a, b) => {
        // 먼저 유사도로 비교 (높은 순)
        if (Math.abs(a.similarity - b.similarity) > 0.1) {
            return b.similarity - a.similarity;
        }
        // 유사도가 비슷하면 거리 차이가 작은 순
        return a.score - b.score;
    });
    const topCandidates = sorted.slice(0, 10);

    console.log(`후보 정렬 완료: ${candidates.length}개 후보 중 상위 ${topCandidates.length}개 선택`);
    console.log('유사도 순위 (상위 10개):', topCandidates.map((s, idx) => 
        `#${idx + 1} 후보(변형: ${s.variation.key}, 템플릿 idx ${s.templateIndex}): 유사도=${s.similarity.toFixed(1)}%, 거리=${(s.distance / 1000).toFixed(2)}km`
    ));

    // 최적 경로가 없으면 상위 후보 중 첫 번째를 사용
    const finalBestRoute = bestRoute || (topCandidates.length > 0 ? {
        coordinates: topCandidates[0].coordinates,
        distance: topCandidates[0].distance,
        nodeKeys: topCandidates[0].nodeKeys,
        templateNodes: topCandidates[0].templateNodes,
        candidateIndex: topCandidates[0].templateIndex
    } : null);

    return {
        bestRoute: finalBestRoute,
        candidates: topCandidates
    };
}

// 모양 템플릿 생성 함수들
// 템플릿 생성 함수는 templates.js로 분리됨

// 로딩 오버레이 표시/숨김
async function showLoadingOverlay(message = '경로를 생성하는 중...') {
    const overlay = document.getElementById('loading-overlay');
    const messageEl = document.getElementById('loading-message');
    if (overlay && messageEl) {
        messageEl.textContent = message;
        overlay.classList.remove('hidden');
        // 브라우저가 렌더링할 시간을 줍니다
        await new Promise(resolve => requestAnimationFrame(resolve));
    }
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
    }
}

// 로딩 메시지 업데이트 함수
function updateLoadingMessage(message) {
    const messageEl = document.getElementById('loading-message');
    if (messageEl) {
        messageEl.textContent = message;
    }
}

// 산책로 생성
async function generateRoute() {
    // 지도가 초기화되지 않았으면 초기화
    if (!map) {
        initMainMap();
    }
    
    if (!map) {
        console.error('지도를 초기화할 수 없습니다.');
        alert('지도를 초기화할 수 없습니다. 페이지를 새로고침해주세요.');
        return;
    }
    
    const routeInfoDiv = document.getElementById('route-info');
    const searchBtn = document.getElementById('search-btn');
    
    if (!routeInfoDiv || !searchBtn) {
        console.error('경로 생성 UI 요소를 찾을 수 없습니다.');
        return;
    }
    
    // 모양 선택 확인
    if (!selectedShape) {
        alert('모양을 선택해주세요.');
        return;
    }
    
    // 버튼 비활성화
    searchBtn.disabled = true;
    searchBtn.textContent = '생성 중...';
    
    // 기존 레이어 제거
    routeLayers.forEach(layer => map.removeLayer(layer));
    routeLayers = [];
    generatedRoute = null;
    
    // 로딩 화면 표시
    showLoadingScreen(selectedShape);
    
    try {
        // 기본 거리 범위 사용 (5~10km)
        let currentLengthRange = DEFAULT_LENGTH_RANGE;
        let isRetry = false;
        
        // 도로 데이터 확인
        if (!roadData) {
            updateLoadingProgress(0, 0, '도로 데이터 로드');
            await loadRoadData();
            if (!roadData) {
                hideLoadingScreen();
                routeInfoDiv.innerHTML = '<p class="info-text" style="color: #dc3545;">도로 데이터를 로드할 수 없습니다.</p>';
                searchBtn.disabled = false;
                searchBtn.textContent = '경로 생성';
                return;
            }
        }

        // 도로 그래프 구축 (아직 안 되어 있으면)
        if (!roadGraph) {
            updateLoadingProgress(0, 0, '도로 네트워크 구축');
            // UI 업데이트를 위해 약간의 지연
            await new Promise(resolve => setTimeout(resolve, 0));
            roadGraph = await buildRoadGraphAsync(null);
            if (!roadGraph) {
                hideLoadingScreen();
                routeInfoDiv.innerHTML = '<p class="info-text" style="color: #dc3545;">도로 네트워크 구축 실패.</p>';
                searchBtn.disabled = false;
                searchBtn.textContent = '경로 생성';
                return;
            }
            
            // 공간 인덱스 구축
            spatialIndex = buildSpatialIndex(roadGraph);
        }

        // 시작점 확인
        const startPoint = selectedStartPoint || DEFAULT_START_POINT;
        if (!startPoint) {
            hideLoadingScreen();
            routeInfoDiv.innerHTML = '<p class="info-text" style="color: #dc3545;">시작점을 선택해주세요.</p>';
            searchBtn.disabled = false;
            searchBtn.textContent = '경로 생성';
            return;
        }
        
        // 템플릿 생성 (한 번만 수행, 루프 밖에서)
        const centerLat = startPoint.lat;
        const centerLon = startPoint.lon;
        
        let template;
        let shapeName = '';
        switch (selectedShape) {
            case 'square':
                template = createSquareTemplate(centerLat, centerLon);
                shapeName = '사각형';
                break;
            case 'triangle':
                template = createTriangleTemplate(centerLat, centerLon);
                shapeName = '삼각형';
                break;
            case 'heart':
                template = createHeartTemplate(centerLat, centerLon);
                shapeName = '하트';
                break;
            case 'slate':
                template = createSlateTemplate(centerLat, centerLon);
                shapeName = '슬레이트런';
                break;
            case 'hanok':
                // 한옥런은 기본 8km로 생성
                template = createHanokTemplate(centerLat, centerLon, 7500);
                shapeName = '한옥런';
                break;
            case 'book':
                template = createBookTemplate(centerLat, centerLon);
                shapeName = '북런';
                break;
                
            default:
                template = createSquareTemplate(centerLat, centerLon);
                shapeName = '사각형';
        }
        
        // POI를 노드에 매핑 (한 번만 수행, 루프 밖에서)
        let mappedPOINodes = null;
        if (selectedPOIs.length > 0) {
            updateLoadingProgress(0, 0, 'POI 매핑');
            console.log(`POI 매핑 시작: ${selectedPOIs.length}개 POI`);
            mappedPOINodes = mapSelectedPOIsToNodes(selectedPOIs, roadGraph, spatialIndex);
            console.log(`POI 매핑 완료: ${mappedPOINodes.length}개 POI가 노드에 매핑됨`);
            
            if (mappedPOINodes.length === 0) {
                hideLoadingScreen();
                routeInfoDiv.innerHTML = '<p class="info-text" style="color: #dc3545;">선택한 POI를 도로 네트워크에 매핑할 수 없습니다.</p>';
                searchBtn.disabled = false;
                searchBtn.textContent = '경로 생성';
                return;
            }
        }
        
        // 경로 생성 시도 (최대 2번: 5~10km, 실패 시 자동으로 10~20km)
        let routeResult = null;
        let bestRoute = null;
        let candidateRoutes = [];
        let firstAttemptSuccess = false;
        
        for (let attempt = 0; attempt < 2; attempt++) {
            if (attempt === 1) {
                // 재시도: 10~20km로 확장
                currentLengthRange = FALLBACK_LENGTH_RANGE;
                isRetry = true;
                updateLoadingProgress(0, 0, '10~20km 재시도');
                await new Promise(resolve => setTimeout(resolve, 100)); // 사용자에게 알리기 위한 최소 지연
            }
            
            // 경로를 선택한 거리 범위의 중간값으로 스케일 조정 (스케일링만 루프 안에서)
            const targetLength = (currentLengthRange.min + currentLengthRange.max) / 2;
            // 한옥런은 이미 올바른 크기(8km)로 생성되었으므로 스케일링 건너뛰기
            const scaledTemplate = (selectedShape === 'hanok') 
                ? template 
                : scalePathToLength(template, targetLength);
            
            // 2. 도로 네트워크를 따라 경로 생성 (2차 단계: 최적화된 다중 후보 평가 + 회전/반전 변형 + POI 방문)
            routeResult = await generateRouteFromRoadNetworkOptimized(
                scaledTemplate, 
                // 후보 진행률만 표시: current/total/stage
                (current, total, stage) => {
                    updateLoadingProgress(current, total, stage);
                },
                {
                    numCandidates: 12, // 곡률 기반 샘플링으로 약 40개 중 12개만 평가
                    includeVariations: true, // 회전/반전 변형 포함 (템플릿 타입에 따라 자동 조정)
                    targetLength: targetLength, // 선택한 거리 범위의 중간값
                    templateType: selectedShape, // 템플릿 타입 전달 (square, triangle, heart 등)
                    startPoint: startPoint, // 선택한 시작점
                    poiNodes: mappedPOINodes // 매핑된 POI 노드들
                }
            );
            
            // 경로 생성 성공 여부 확인
            if (routeResult && routeResult.bestRoute && routeResult.bestRoute.coordinates && routeResult.bestRoute.coordinates.length >= 2) {
                bestRoute = routeResult.bestRoute;
                candidateRoutes = routeResult.candidates || [];
                
                // 첫 번째 시도(5~10km)에서 성공했으면 결과 화면으로 전환
                if (attempt === 0) {
                    firstAttemptSuccess = true;
                    hideLoadingScreen();
                    showResultScreen(bestRoute, candidateRoutes, shapeName, startPoint, template, mappedPOINodes, selectedShape);
                    searchBtn.disabled = false;
                    searchBtn.textContent = '경로 생성';
                    return; // 결과 화면으로 전환 후 종료
                } else {
                    // 두 번째 시도에서 성공했으면 결과 화면으로 전환
                    hideLoadingScreen();
                    showResultScreen(bestRoute, candidateRoutes, shapeName, startPoint, template, mappedPOINodes, selectedShape);
                    searchBtn.disabled = false;
                    searchBtn.textContent = '경로 생성';
                    break;
                }
            }
            
            // 실패했고 첫 번째 시도였다면 자동으로 재시도
            if (attempt === 0) {
                console.log('5~10km 경로 생성 실패. 10~20km로 자동 재시도합니다.');
                continue;
            }
        }
        
        // 모든 시도 실패
        if (!bestRoute) {
            hideLoadingScreen();
            routeInfoDiv.innerHTML = '<p class="info-text" style="color: #dc3545;">경로를 생성할 수 없습니다. POI 선택을 조정하거나 시작점을 변경해보세요.</p>';
            searchBtn.disabled = false;
            searchBtn.textContent = '경로 생성';
            return;
        }

        // 결과 화면으로 전환
        hideLoadingScreen();
        showResultScreen(bestRoute, candidateRoutes, shapeName, startPoint, template, mappedPOINodes, selectedShape);
        
        searchBtn.disabled = false;
        searchBtn.textContent = '경로 생성';
    } catch (error) {
        console.error('경로 생성 오류:', error);
        hideLoadingScreen();
        routeInfoDiv.innerHTML = `<p class="info-text" style="color: #dc3545;">경로 생성 중 오류가 발생했습니다: ${error.message}</p>`;
        searchBtn.disabled = false;
        searchBtn.textContent = '경로 생성';
    }
}

// 전역 변수: 재탐색에 필요한 정보 저장
let retryTemplate = null;
let retryMappedPOINodes = null;
let retrySelectedShape = null;
let retryShapeName = null;
let retryStartPoint = null;

// 10~20km 범위로 재탐색 수행
async function retryWithLongerRange() {
    if (!retryTemplate || !retrySelectedShape || !retryShapeName || !retryStartPoint) {
        console.error('재탐색에 필요한 정보가 없습니다.');
        return;
    }
    
    // 로딩 화면 표시
    showLoadingScreen(retrySelectedShape);
    
    try {
        const currentLengthRange = FALLBACK_LENGTH_RANGE; // 10~20km
        
        // 경로를 선택한 거리 범위의 중간값으로 스케일 조정
        const targetLength = (currentLengthRange.min + currentLengthRange.max) / 2;
        // 한옥런은 이미 올바른 크기(8km)로 생성되었으므로 스케일링 건너뛰기
        const scaledTemplate = (retrySelectedShape === 'hanok') 
            ? retryTemplate 
            : scalePathToLength(retryTemplate, targetLength);
        
        // 도로 네트워크를 따라 경로 생성
        const routeResult = await generateRouteFromRoadNetworkOptimized(
            scaledTemplate, 
            (current, total, stage) => {
                updateLoadingProgress(current, total, stage);
            },
            {
                numCandidates: 12,
                includeVariations: true,
                targetLength: targetLength,
                templateType: retrySelectedShape,
                startPoint: retryStartPoint,
                poiNodes: retryMappedPOINodes
            }
        );
        
        if (routeResult && routeResult.bestRoute && routeResult.bestRoute.coordinates && routeResult.bestRoute.coordinates.length >= 2) {
            // 재탐색 결과 화면으로 전환
            hideLoadingScreen();
            showResultScreen(routeResult.bestRoute, routeResult.candidates || [], retryShapeName, retryStartPoint, retryTemplate, retryMappedPOINodes, retrySelectedShape);
        } else {
            hideLoadingScreen();
            alert('10~20km 범위에서도 경로를 생성할 수 없습니다. POI 선택을 조정하거나 시작점을 변경해보세요.');
        }
    } catch (error) {
        console.error('재탐색 오류:', error);
        hideLoadingScreen();
        alert(`재탐색 중 오류가 발생했습니다: ${error.message}`);
    }
}

// 재탐색 정보 저장 함수
function saveRetryInfo(template, mappedPOINodes, selectedShape, shapeName, startPoint) {
    retryTemplate = template;
    retryMappedPOINodes = mappedPOINodes;
    retrySelectedShape = selectedShape;
    retryShapeName = shapeName;
    retryStartPoint = startPoint;
}

// 10~20km 범위로 재탐색 수행 (이전 버전 호환용, 사용하지 않음)
async function retryWithLongerRangeOld(template, mappedPOINodes, selectedShape, shapeName, startPoint) {
    const routeInfoDiv = document.getElementById('route-info');
    const searchBtn = document.getElementById('search-btn');
    
    // 버튼 비활성화
    searchBtn.disabled = true;
    searchBtn.textContent = '재탐색 중...';
    
    // 기존 레이어 제거
    routeLayers.forEach(layer => map.removeLayer(layer));
    routeLayers = [];
    generatedRoute = null;
    
    try {
        const currentLengthRange = FALLBACK_LENGTH_RANGE; // 10~20km
        const isRetry = true;
        
        routeInfoDiv.innerHTML = `<p class="info-text">10~20km 범위로 재탐색 중...</p>`;
        
        // 경로를 선택한 거리 범위의 중간값으로 스케일 조정
        const targetLength = (currentLengthRange.min + currentLengthRange.max) / 2;
        // 한옥런은 이미 올바른 크기(8km)로 생성되었으므로 스케일링 건너뛰기
        const scaledTemplate = (selectedShape === 'hanok') 
            ? template 
            : scalePathToLength(template, targetLength);
        
        // 도로 네트워크를 따라 경로 생성
        const routeResult = await generateRouteFromRoadNetworkOptimized(
            scaledTemplate, 
            (current, total, stage) => {
                const stageText = stage || '평가';
                routeInfoDiv.innerHTML = `<p class="info-text">${stageText}: ${current}/${total} (10~20km 재탐색)</p>`;
            },
            {
                numCandidates: 12,
                includeVariations: true,
                targetLength: targetLength,
                templateType: selectedShape,
                startPoint: startPoint,
                poiNodes: mappedPOINodes
            }
        );
        
        if (routeResult && routeResult.bestRoute && routeResult.bestRoute.coordinates && routeResult.bestRoute.coordinates.length >= 2) {
            // 재탐색 결과 표시
            await displayRouteResult(routeResult.bestRoute, routeResult.candidates || [], shapeName, startPoint, true, template, mappedPOINodes, selectedShape);
        } else {
            routeInfoDiv.innerHTML = '<p class="info-text" style="color: #dc3545;">10~20km 범위에서도 경로를 생성할 수 없습니다. POI 선택을 조정하거나 시작점을 변경해보세요.</p>';
        }
        
        searchBtn.disabled = false;
        searchBtn.textContent = '경로 생성';
    } catch (error) {
        console.error('재탐색 오류:', error);
        routeInfoDiv.innerHTML = `<p class="info-text" style="color: #dc3545;">재탐색 중 오류가 발생했습니다: ${error.message}</p>`;
        searchBtn.disabled = false;
        searchBtn.textContent = '경로 생성';
    }
}

// 로딩 화면 표시 함수
function showLoadingScreen(shapeType) {
    const loadingScreen = document.getElementById('loading-screen');
    const loadingShapeImage = document.getElementById('loading-shape-image');
    const loadingProgressText = document.getElementById('loading-progress-text');
    const loadingProgressCount = document.getElementById('loading-progress-count');
    
    if (loadingScreen && loadingShapeImage) {
        // 선택된 모양에 맞는 이미지 설정
        const shapeImages = {
            'square': 'images/square.png',
            'triangle': 'images/triangle.png',
            'heart': 'images/heart.png',
            'slate': 'images/slate.png',
            'hanok': 'images/hanok.png',
            'book': 'images/book.png'
        };
        
        loadingShapeImage.src = shapeImages[shapeType] || shapeImages['square'];
        loadingProgressText.textContent = '경로 생성 중...';
        loadingProgressCount.textContent = '0/0';
        loadingScreen.classList.remove('hidden');
    }
}

// 로딩 화면 숨김 함수
function hideLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        loadingScreen.classList.add('hidden');
    }
}

// 로딩 진행 상황 업데이트 함수
function updateLoadingProgress(current, total, stage) {
    const loadingProgressText = document.getElementById('loading-progress-text');
    const loadingProgressCount = document.getElementById('loading-progress-count');
    
    if (loadingProgressText && loadingProgressCount) {
        const stageText = stage || '평가';
        loadingProgressText.textContent = `${stageText} 중...`;
        loadingProgressCount.textContent = `${current}/${total}`;
    }
}

// 결과 화면 지도 변수
let resultMap = null;

// 결과 화면 표시 함수
function showResultScreen(bestRoute, candidateRoutes, shapeName, startPoint, template = null, mappedPOINodes = null, selectedShape = null) {
    const resultScreen = document.getElementById('result-screen');
    const mainContent = document.getElementById('main-content');
    
    if (!resultScreen) return;
    
    // 메인 컨텐츠 숨기기
    if (mainContent) {
        mainContent.classList.add('hidden');
    }
    
    // 로딩 화면 숨기기
    hideLoadingScreen();
    
    // 결과 화면 표시
    resultScreen.classList.remove('hidden');
    
    // 재탐색 정보 저장 (파라미터가 제공된 경우만)
    if (template && selectedShape) {
        saveRetryInfo(template, mappedPOINodes, selectedShape, shapeName, startPoint);
    }
    
    // 결과 화면 지도 초기화
    setTimeout(() => {
        initResultMap(bestRoute, candidateRoutes, shapeName, startPoint);
        renderResultCandidates(candidateRoutes, bestRoute, shapeName, startPoint, selectedShape || 'square');
    }, 100);
}

// 결과 화면 지도 초기화
function initResultMap(bestRoute, candidateRoutes, shapeName, startPoint) {
    const resultMapContainer = document.getElementById('result-map');
    if (!resultMapContainer) return;
    
    // 기존 지도 제거
    if (resultMap) {
        resultMap.remove();
        resultMap = null;
    }
    
    // 새 지도 생성
    resultMap = L.map('result-map').setView([startPoint.lat, startPoint.lon], 13);
    
    // OpenStreetMap 타일 레이어 추가
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(resultMap);
    
    // 첫 번째 경로 표시
    displayRouteOnResultMap(bestRoute, startPoint, shapeName);
}

// 결과 화면에 경로 표시
let resultRouteLayers = [];
function displayRouteOnResultMap(route, startPoint, shapeName) {
    if (!resultMap) return;
    
    // 기존 레이어 제거
    resultRouteLayers.forEach(layer => resultMap.removeLayer(layer));
    resultRouteLayers = [];
    
    // 경로 표시
    const routeLayer = L.polyline(route.coordinates, {
        color: '#667eea',
        weight: 6,
        opacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round'
    }).addTo(resultMap);
    
    // 시작점 마커
    const startMarker = L.marker([startPoint.lat, startPoint.lon], {
        icon: L.divIcon({
            className: 'start-marker',
            html: '<div style="background: #28a745; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        })
    }).addTo(resultMap);
    
    routeLayer.bindPopup(`
        <b>드로잉 런 경로</b><br>
        모양: ${shapeName}<br>
        길이: ${(route.distance / 1000).toFixed(2)} km<br>
        유사도: ${(route.similarity || 0).toFixed(1)}%
    `);
    
    resultRouteLayers.push(routeLayer);
    resultRouteLayers.push(startMarker);
    
    // 지도 범위 조정
    const group = new L.featureGroup(resultRouteLayers);
    resultMap.fitBounds(group.getBounds().pad(0.15));
}

// 경로 미리보기 생성 함수 (Canvas 사용)
function createRoutePreview(coordinates, width = 60, height = 60) {
    if (!coordinates || coordinates.length < 2) {
        return null;
    }
    
    // 좌표 범위 계산
    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;
    
    coordinates.forEach(coord => {
        const [lat, lon] = coord;
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
    });
    
    const latRange = maxLat - minLat;
    const lonRange = maxLon - minLon;
    const padding = 0.1; // 10% 패딩
    
    // Canvas 생성
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    // 배경 그리기
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, width, height);
    
    // 경로 좌표를 Canvas 좌표로 변환
    const points = coordinates.map(coord => {
        const [lat, lon] = coord;
        const x = ((lon - minLon) / lonRange) * (width * (1 - 2 * padding)) + width * padding;
        const y = height - (((lat - minLat) / latRange) * (height * (1 - 2 * padding)) + height * padding);
        return { x, y };
    });
    
    // 경로 그리기
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    
    points.forEach((point, idx) => {
        if (idx === 0) {
            ctx.moveTo(point.x, point.y);
        } else {
            ctx.lineTo(point.x, point.y);
        }
    });
    
    ctx.stroke();
    
    // 시작점 마커 그리기
    if (points.length > 0) {
        const startPoint = points[0];
        ctx.fillStyle = '#28a745';
        ctx.beginPath();
        ctx.arc(startPoint.x, startPoint.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }
    
    return canvas.toDataURL('image/png');
}

// 결과 후보 목록 렌더링
function renderResultCandidates(candidateRoutes, bestRoute, shapeName, startPoint, selectedShape) {
    const resultCandidateList = document.getElementById('result-candidate-list');
    if (!resultCandidateList) return;
    
    // 상위 10개만 표시
    const top10Candidates = candidateRoutes.slice(0, 10);
    
    const candidatesHtml = top10Candidates.map((c, idx) => {
        const diffKm = (c.distance - bestRoute.distance) / 1000;
        const diffText = diffKm === 0 ? '동일' : `${diffKm > 0 ? '+' : ''}${diffKm.toFixed(2)} km`;
        const similarityPct = c.similarity || 0;
        
        // 변형 정보 표시 (회전 각도 제거, 좌우반전만 표시)
        let variationText = '';
        if (c.variation && c.variation.flip !== 1) {
            variationText = `<div class="result-candidate-variation">좌우반전</div>`;
        }
        
        // 경로 미리보기 생성
        const previewDataUrl = createRoutePreview(c.coordinates, 60, 60);
        
        return `
            <div class="result-candidate-item ${idx === 0 ? 'active' : ''}" data-candidate-index="${idx}">
                <div class="result-candidate-header">
                    <div class="result-candidate-rank">#${idx + 1}</div>
                    <div class="result-candidate-info">
                        <p><strong>거리:</strong> ${(c.distance / 1000).toFixed(2)} km <span style="color:#6c757d;">(${diffText})</span></p>
                        <p><strong>유사도:</strong> ${similarityPct.toFixed(1)}%</p>
                        ${variationText}
                    </div>
                    <div class="result-candidate-shape">
                        ${previewDataUrl ? `<img src="${previewDataUrl}" alt="경로 미리보기" class="result-candidate-shape-image">` : '<div class="result-candidate-shape-placeholder">미리보기 없음</div>'}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    resultCandidateList.innerHTML = candidatesHtml || '<p style="padding: 20px; text-align: center; color: #6c757d;">후보 경로가 없습니다.</p>';
    
    // 후보 클릭 이벤트 등록
    const candidateItems = resultCandidateList.querySelectorAll('.result-candidate-item');
    let selectedCandidateIndex = 0; // 현재 선택된 후보 인덱스 저장
    
    candidateItems.forEach(item => {
        item.addEventListener('click', () => {
            const idx = parseInt(item.getAttribute('data-candidate-index') || '0', 10);
            const selected = top10Candidates[idx];
            if (!selected) return;
            
            // 이미 선택된 항목을 다시 클릭하면 드로잉런 실행 화면으로 이동
            if (selectedCandidateIndex === idx && item.classList.contains('active')) {
                // 확인 다이얼로그 표시
                if (confirm('이 경로로 드로잉런을 진행하겠습니까?')) {
                    showRunningScreen(selected, startPoint, shapeName, selectedShape);
                }
                return;
            }
            
            // active 클래스 변경
            candidateItems.forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            selectedCandidateIndex = idx;
            
            // 지도에 선택된 경로 표시
            displayRouteOnResultMap(selected, startPoint, shapeName);
        });
    });
}

// 결과 화면 숨김 함수
function hideResultScreen() {
    const resultScreen = document.getElementById('result-screen');
    const mainContent = document.getElementById('main-content');
    
    if (resultScreen) {
        resultScreen.classList.add('hidden');
    }
    
    if (mainContent) {
        mainContent.classList.remove('hidden');
    }
}

// 두 좌표 간 거리 계산 (Haversine 공식, 미터 단위)
function calculateDistanceBetweenCoords(lat1, lon1, lat2, lon2) {
    const R = 6371000; // 지구 반경 (미터)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// 드로잉런 실행 화면 관련 변수
let runningMap = null;
let runningRouteLayer = null;
let runningPOIMarkers = [];
let runnerMarker = null;
let runningTrackLayer = null;
let runningTrackCoordinates = [];
let isRunning = false;
let watchId = null;
let currentRunningRoute = null;
let currentRunningStartPoint = null;
let animationFrameId = null;
let animationTimeoutId = null; // 애니메이션 setTimeout ID 저장
let routeAnimationIndex = 0;
let isAnimating = false;

// HTTPS 환경 확인
function isSecureContext() {
    return window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

// 드로잉런 실행 화면 표시 함수
function showRunningScreen(route, startPoint, shapeName, selectedShape) {
    const runningScreen = document.getElementById('running-screen');
    const resultScreen = document.getElementById('result-screen');
    
    if (!runningScreen) return;
    
    // 결과 화면 숨기기
    if (resultScreen) {
        resultScreen.classList.add('hidden');
    }
    
    // 드로잉런 실행 화면 표시
    runningScreen.classList.remove('hidden');
    
    // 현재 경로 저장
    currentRunningRoute = route;
    currentRunningStartPoint = startPoint;
    
    // 초기화
    isRunning = false;
    isAnimating = false;
    runningTrackCoordinates = [];
    routeAnimationIndex = 0;
    animationTimeoutId = null; // 타이머 ID 초기화
    
    // 상태 업데이트
    const statusText = document.getElementById('running-status-text');
    if (statusText) {
        statusText.textContent = '경로를 확인하고 시작 버튼을 눌러주세요';
    }
    
    // 버튼 상태 업데이트
    const startBtn = document.getElementById('start-running-btn');
    const animationBtn = document.getElementById('start-animation-btn');
    const stopBtn = document.getElementById('stop-running-btn');
    if (startBtn) startBtn.classList.remove('hidden');
    if (animationBtn) animationBtn.classList.remove('hidden');
    if (stopBtn) stopBtn.classList.add('hidden');
    
    // 지도 초기화
    setTimeout(() => {
        initRunningMap(route, startPoint, shapeName);
    }, 100);
}

// 드로잉런 실행 화면 지도 초기화
function initRunningMap(route, startPoint, shapeName) {
    const runningMapContainer = document.getElementById('running-map');
    if (!runningMapContainer) return;
    
    // 기존 지도 제거
    if (runningMap) {
        runningMap.remove();
        runningMap = null;
    }
    
    // 새 지도 생성
    runningMap = L.map('running-map').setView([startPoint.lat, startPoint.lon], 14);
    
    // OpenStreetMap 타일 레이어 추가
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(runningMap);
    
    // 경로 표시
    runningRouteLayer = L.polyline(route.coordinates, {
        color: '#667eea',
        weight: 6,
        opacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round'
    }).addTo(runningMap);
    
    // POI 마커 표시
    displayPOIsOnRunningMap();
    
    // 지도 범위 조정
    const bounds = L.latLngBounds(route.coordinates);
    runningMap.fitBounds(bounds.pad(0.15));
    
    // HTTPS가 아닌 경우 자동 애니메이션 모드로 전환
    if (!isSecureContext()) {
        const statusText = document.getElementById('running-status-text');
        if (statusText) {
            statusText.textContent = 'HTTP 환경: 자동 애니메이션 모드';
        }
    } else {
        // GPS 위치 가져오기
        getUserLocationForRunning();
    }
}

// POI를 드로잉런 지도에 표시
function displayPOIsOnRunningMap() {
    if (!runningMap || !selectedPOIs || selectedPOIs.length === 0) return;
    
    // 기존 POI 마커 제거
    runningPOIMarkers.forEach(marker => runningMap.removeLayer(marker));
    runningPOIMarkers = [];
    
    // POI 마커 추가
    selectedPOIs.forEach(poi => {
        const marker = L.marker([poi.lat, poi.lon], {
            icon: L.divIcon({
                className: 'poi-teardrop-marker',
                html: `
                    <svg width="40" height="50" viewBox="0 0 40 50" xmlns="http://www.w3.org/2000/svg">
                        <path d="M20 0 C31 0 40 9 40 20 C40 35 20 50 20 50 C20 50 0 35 0 20 C0 9 9 0 20 0 Z" fill="#4A90E2" stroke="#fff" stroke-width="2"/>
                        <circle cx="20" cy="20" r="10" fill="#fff"/>
                    </svg>
                `,
                iconSize: [40, 50],
                iconAnchor: [20, 50]
            })
        }).addTo(runningMap);
        
        marker.bindPopup(`<b>${poi.name}</b><br>${poi.category || ''}`);
        runningPOIMarkers.push(marker);
    });
}

// 드로잉런 실행 화면에서 사용자 위치 가져오기
function getUserLocationForRunning() {
    if (!navigator.geolocation) {
        alert('GPS 기능을 사용할 수 없습니다.');
        return;
    }
    
    const options = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
    };
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            
            // Runner 마커 표시
            displayRunnerMarker(lat, lon);
            
            // 지도 중심 이동
            if (runningMap) {
                runningMap.setView([lat, lon], 16);
            }
        },
        (error) => {
            console.error('GPS 오류:', error);
            alert('위치 정보를 가져올 수 없습니다. GPS 권한을 확인해주세요.');
        },
        options
    );
}

// Runner 마커 표시
function displayRunnerMarker(lat, lon) {
    if (!runningMap) return;
    
    // 기존 Runner 마커 제거
    if (runnerMarker) {
        runningMap.removeLayer(runnerMarker);
    }
    
    // Runner.png 아이콘 생성
    const runnerIcon = L.icon({
        iconUrl: 'images/Runner.png',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -20]
    });
    
    runnerMarker = L.marker([lat, lon], { icon: runnerIcon }).addTo(runningMap);
    runnerMarker.bindPopup('<b>내 위치</b>').openPopup();
}

// HTTP 환경에서 경로를 따라가는 애니메이션
function animateRouteFollowing() {
    // 애니메이션이 중지되었으면 즉시 종료
    if (!isAnimating) {
        return;
    }
    
    // 도착점 도달 확인
    if (!currentRunningRoute || !currentRunningRoute.coordinates || routeAnimationIndex >= currentRunningRoute.coordinates.length) {
        // 애니메이션 완료 - stopRunning에서 상태를 관리하므로 여기서는 호출만
        stopRunning();
        return;
    }
    
    const currentCoord = currentRunningRoute.coordinates[routeAnimationIndex];
    const [lat, lon] = currentCoord;
    
    // Runner 마커 업데이트
    if (runnerMarker) {
        runnerMarker.setLatLng([lat, lon]);
    } else {
        displayRunnerMarker(lat, lon);
    }
    
    // 지도 중심 이동
    if (runningMap) {
        runningMap.setView([lat, lon], 16);
    }
    
    // 동선 좌표 추가
    runningTrackCoordinates.push([lat, lon]);
    
    // 동선 업데이트
    updateRunningTrack();
    
    // 다음 좌표로 이동할 시간 계산
    if (routeAnimationIndex < currentRunningRoute.coordinates.length - 1) {
        const nextCoord = currentRunningRoute.coordinates[routeAnimationIndex + 1];
        const [nextLat, nextLon] = nextCoord;
        
        // 거리 계산 (미터)
        const distance = calculateDistanceBetweenCoords(lat, lon, nextLat, nextLon);
        
        // 속도: 500m/s, 시간 계산 (밀리초)
        const timeMs = (distance / 500) * 1000;
        
        routeAnimationIndex++;
        
        // 다음 좌표로 이동 (타임아웃 ID 저장)
        animationTimeoutId = setTimeout(() => {
            if (isAnimating) {
                animateRouteFollowing();
            }
        }, Math.max(50, timeMs)); // 최소 50ms 간격
    } else {
        // 마지막 좌표에 도달 - 경로 완료
        // stopRunning에서 상태를 관리하므로 여기서는 호출만
        stopRunning();
    }
}

// 애니메이션 모드 시작 (HTTPS 환경에서도 사용 가능)
function startAnimationMode() {
    if (isRunning || isAnimating) return;
    
    if (!currentRunningRoute || !currentRunningRoute.coordinates || currentRunningRoute.coordinates.length === 0) {
        alert('경로가 선택되지 않았습니다. 먼저 경로를 선택해주세요.');
        return;
    }
    
    isRunning = false; // GPS 추적은 하지 않음
    isAnimating = true; // 애니메이션만 실행
    runningTrackCoordinates = [];
    routeAnimationIndex = 0;
    animationTimeoutId = null; // 타이머 ID 초기화
    
    // 파란 경로 레이어가 없거나 지도에서 제거되었으면 다시 추가
    if (!runningRouteLayer || !runningMap.hasLayer(runningRouteLayer)) {
        if (runningMap && currentRunningRoute && currentRunningRoute.coordinates) {
            // 기존 레이어가 있으면 제거
            if (runningRouteLayer) {
                runningMap.removeLayer(runningRouteLayer);
            }
            // 새 레이어 추가
            runningRouteLayer = L.polyline(currentRunningRoute.coordinates, {
                color: '#667eea',
                weight: 6,
                opacity: 0.9,
                lineJoin: 'round',
                lineCap: 'round'
            }).addTo(runningMap);
        }
    }
    
    // 상태 업데이트
    const statusText = document.getElementById('running-status-text');
    if (statusText) {
        statusText.textContent = '애니메이션 진행 중...';
    }
    
    // 버튼 상태 업데이트
    const startBtn = document.getElementById('start-running-btn');
    const animationBtn = document.getElementById('start-animation-btn');
    const stopBtn = document.getElementById('stop-running-btn');
    if (startBtn) startBtn.classList.add('hidden');
    if (animationBtn) animationBtn.classList.add('hidden');
    if (stopBtn) stopBtn.classList.remove('hidden');
    
    // 첫 번째 좌표에 Runner 마커 배치
    if (currentRunningRoute && currentRunningRoute.coordinates.length > 0) {
        const firstCoord = currentRunningRoute.coordinates[0];
        const [firstLat, firstLon] = firstCoord;
        displayRunnerMarker(firstLat, firstLon);
    }
    
    // 애니메이션 시작
    animateRouteFollowing();
}

// 드로잉런 시작
function startRunning() {
    if (isRunning || isAnimating) return;
    
    isRunning = true;
    isAnimating = true;
    runningTrackCoordinates = [];
    routeAnimationIndex = 0;
    animationTimeoutId = null; // 타이머 ID 초기화
    
    // 파란 경로 레이어가 없거나 지도에서 제거되었으면 다시 추가
    if (!runningRouteLayer || !runningMap.hasLayer(runningRouteLayer)) {
        if (runningMap && currentRunningRoute && currentRunningRoute.coordinates) {
            // 기존 레이어가 있으면 제거
            if (runningRouteLayer) {
                runningMap.removeLayer(runningRouteLayer);
            }
            // 새 레이어 추가
            runningRouteLayer = L.polyline(currentRunningRoute.coordinates, {
                color: '#667eea',
                weight: 6,
                opacity: 0.9,
                lineJoin: 'round',
                lineCap: 'round'
            }).addTo(runningMap);
        }
    }
    
    // 상태 업데이트
    const statusText = document.getElementById('running-status-text');
    if (statusText) {
        if (isSecureContext()) {
            statusText.textContent = '드로잉런 진행 중...';
        } else {
            statusText.textContent = '자동 애니메이션 진행 중...';
        }
    }
    
    // 버튼 상태 업데이트
    const startBtn = document.getElementById('start-running-btn');
    const animationBtn = document.getElementById('start-animation-btn');
    const stopBtn = document.getElementById('stop-running-btn');
    if (startBtn) startBtn.classList.add('hidden');
    if (animationBtn) animationBtn.classList.add('hidden');
    if (stopBtn) stopBtn.classList.remove('hidden');
    
    // HTTPS 환경: GPS 추적 시작
    if (isSecureContext() && navigator.geolocation) {
        const options = {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        };
        
        watchId = navigator.geolocation.watchPosition(
            (position) => {
                // 실행 중이 아니면 즉시 종료
                if (!isRunning) {
                    return;
                }
                
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                
                // Runner 마커 업데이트
                if (runnerMarker) {
                    runnerMarker.setLatLng([lat, lon]);
                } else {
                    displayRunnerMarker(lat, lon);
                }
                
                // 지도 중심 이동
                if (runningMap) {
                    runningMap.setView([lat, lon], 16);
                }
                
                // 동선 좌표 추가
                runningTrackCoordinates.push([lat, lon]);
                
                // 동선 업데이트
                updateRunningTrack();
                
                // 도착점 도달 확인 (경로의 마지막 좌표와의 거리)
                if (currentRunningRoute && currentRunningRoute.coordinates && currentRunningRoute.coordinates.length > 0) {
                    const destination = currentRunningRoute.coordinates[currentRunningRoute.coordinates.length - 1];
                    const [destLat, destLon] = destination;
                    const distanceToDestination = calculateDistanceBetweenCoords(lat, lon, destLat, destLon);
                    
                    // 도착점으로부터 50m 이내에 도달하면 자동 중지
                    if (distanceToDestination <= 50) {
                        console.log('도착점 도달! 드로잉런을 자동으로 중지합니다.');
                        stopRunning();
                    }
                }
            },
            (error) => {
                console.error('GPS 추적 오류:', error);
            },
            options
        );
    } else {
        // HTTP 환경: 자동 애니메이션 시작
        // 첫 번째 좌표에 Runner 마커 배치
        if (currentRunningRoute && currentRunningRoute.coordinates.length > 0) {
            const firstCoord = currentRunningRoute.coordinates[0];
            const [firstLat, firstLon] = firstCoord;
            displayRunnerMarker(firstLat, firstLon);
        }
        
        // 애니메이션 시작
        animateRouteFollowing();
    }
}

// 드로잉런 중지
function stopRunning() {
    // 애니메이션이나 실행이 진행 중이 아니면 버튼 상태만 업데이트하고 종료
    const wasRunning = isRunning || isAnimating;
    
    if (!wasRunning) {
        // 이미 완료된 상태지만 버튼 상태는 업데이트
        const startBtn = document.getElementById('start-running-btn');
        const animationBtn = document.getElementById('start-animation-btn');
        const stopBtn = document.getElementById('stop-running-btn');
        if (startBtn) startBtn.classList.remove('hidden');
        if (animationBtn) animationBtn.classList.remove('hidden');
        if (stopBtn) stopBtn.classList.add('hidden');
        return;
    }
    
    isRunning = false;
    isAnimating = false;
    
    // GPS 추적 중지
    if (watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    
    // 애니메이션 타이머 중지
    if (animationTimeoutId !== null) {
        clearTimeout(animationTimeoutId);
        animationTimeoutId = null;
    }
    
    // 애니메이션 프레임 중지
    if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    
    // 상태 업데이트
    const statusText = document.getElementById('running-status-text');
    if (statusText) {
        statusText.textContent = '드로잉런이 완료되었습니다. 그려진 경로를 확인하세요.';
    }
    
    // 버튼 상태 업데이트
    const startBtn = document.getElementById('start-running-btn');
    const animationBtn = document.getElementById('start-animation-btn');
    const stopBtn = document.getElementById('stop-running-btn');
    if (startBtn) startBtn.classList.remove('hidden');
    if (animationBtn) animationBtn.classList.remove('hidden');
    if (stopBtn) stopBtn.classList.add('hidden');
    
    // 파란 경로 레이어는 제거하지 않음 (다시 시작할 때 필요)
    // 대신 붉은 선만 표시되도록 하기 위해 파란 경로는 유지하되
    // 사용자가 다시 시작할 수 있도록 함
    
    // 지도 범위 조정 (그려진 경로에 맞춤)
    if (runningTrackCoordinates.length > 0 && runningMap) {
        const bounds = L.latLngBounds(runningTrackCoordinates);
        runningMap.fitBounds(bounds.pad(0.2));
    }
}

// 동선 업데이트 (붉은 선으로 표시)
function updateRunningTrack() {
    if (runningTrackCoordinates.length < 2 || !runningMap) return;
    
    // 기존 동선 레이어 제거
    if (runningTrackLayer) {
        runningMap.removeLayer(runningTrackLayer);
    }
    
    // 새로운 동선 레이어 생성
    runningTrackLayer = L.polyline(runningTrackCoordinates, {
        color: '#dc3545',
        weight: 5,
        opacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round'
    }).addTo(runningMap);
}

// 드로잉런 실행 화면 숨김 함수
function hideRunningScreen() {
    const runningScreen = document.getElementById('running-screen');
    const resultScreen = document.getElementById('result-screen');
    
    // GPS 추적 중지
    if (watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    
    // 애니메이션 중지
    if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    
    isRunning = false;
    isAnimating = false;
    
    if (runningScreen) {
        runningScreen.classList.add('hidden');
    }
    
    if (resultScreen) {
        resultScreen.classList.remove('hidden');
    }
}

// 경로 결과 표시 함수 (재사용 가능)
async function displayRouteResult(bestRoute, candidateRoutes, shapeName, startPoint, isRetry, template, mappedPOINodes, selectedShape) {
    const routeInfoDiv = document.getElementById('route-info');
    
    generatedRoute = {
        coordinates: bestRoute.coordinates,
        length: bestRoute.distance,
        shape: selectedShape,
        shapeName: shapeName
    };
    
    // 3. 지도에 표시
    if (!map) {
        console.error('지도가 초기화되지 않았습니다.');
        return;
    }
    
    // 실제 경로 표시
    const routeLayer = L.polyline(bestRoute.coordinates, {
        color: '#667eea',
        weight: 6,
        opacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round'
    }).addTo(map);
    
    // 시작점 마커
    if (startPointMarker) {
        map.removeLayer(startPointMarker);
    }
    startPointMarker = L.marker([startPoint.lat, startPoint.lon], {
        icon: L.divIcon({
            className: 'start-marker',
            html: '<div style="background: #28a745; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        })
    }).addTo(map);
    startPointMarker.bindPopup(`<b>시작점</b><br>위도: ${startPoint.lat.toFixed(6)}<br>경도: ${startPoint.lon.toFixed(6)}`).openPopup();
    
    // 경로 정보 팝업
    routeLayer.bindPopup(`
        <b>드로잉 런 경로</b><br>
        모양: ${shapeName}<br>
        길이: ${(bestRoute.distance / 1000).toFixed(2)} km<br>
        시작점: 위도 ${startPoint.lat.toFixed(6)}, 경도 ${startPoint.lon.toFixed(6)}
    `);
    
    routeLayers.push(routeLayer);
    routeLayers.push(startPointMarker);
    
    // 4. 지도 범위 조정
    const group = new L.featureGroup(routeLayers);
    map.fitBounds(group.getBounds().pad(0.15));
    
    // 5. 정보 표시
    let rangeText;
    if (isRetry) {
        rangeText = `<span style="color: #ff9800;">(10~20km 범위로 자동 확장)</span>`;
    } else {
        rangeText = `<span style="color: #28a745;">(5~10km 범위)</span>`;
    }
    
    // 5~10km 결과일 때 재탐색 버튼 추가
    const retryButtonHtml = !isRetry ? `
        <div style="margin-top: 20px; padding-top: 20px; border-top: 2px solid #e9ecef;">
            <p style="margin-bottom: 10px; color: #6c757d; font-size: 0.9em;">
                마음에 드는 경로가 없으신가요?
            </p>
            <button id="retry-with-longer-range" style="padding: 12px 24px; background: #ff9800; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 1em; width: 100%;">
                10~20km 범위로 재탐색하기
            </button>
        </div>
    ` : '';
    
    // 상위 후보 리스트 HTML 생성
    let candidatesHtml = '';
    if (candidateRoutes.length > 0) {
        const candidatesListHtml = candidateRoutes.map((c, idx) => {
                const diffKm = (c.distance - bestRoute.distance) / 1000;
                const diffText = diffKm === 0 ? '동일' : `${diffKm > 0 ? '+' : ''}${diffKm.toFixed(2)} km`;
                // 유사도는 직접 사용 (이미 계산된 값)
                const similarityPct = c.similarity || 0;
                
                // 변형 정보 표시
                let variationText = '';
                if (c.variation) {
                    const rotationText = c.variation.rotation === 0 ? '원본' : `${c.variation.rotation}° 회전`;
                    const flipText = c.variation.flip === 1 ? '' : ' (좌우반전)';
                    variationText = `<span style="color:#6c757d; font-size:0.85em;">${rotationText}${flipText}</span>`;
                }
                
                return `
                    <div class="candidate-item ${idx === 0 ? 'active' : ''}" data-candidate-index="${idx}">
                        <div class="candidate-rank">#${idx + 1}</div>
                        <div class="candidate-info">
                            <p><strong>거리:</strong> ${(c.distance / 1000).toFixed(2)} km <span style="color:#6c757d;">(${diffText})</span></p>
                            <p><strong>유사도:</strong> ${similarityPct.toFixed(1)}% <span style="color:#6c757d;">(템플릿 형태 일치도)</span></p>
                            ${variationText ? `<p>${variationText}</p>` : ''}
                        </div>
                    </div>
                `;
        }).join('');

        candidatesHtml = `
            <div class="candidate-list-container">
                <h4>상위 ${candidateRoutes.length}개 후보 경로</h4>
                <div class="candidate-list">
                    ${candidatesListHtml}
                </div>
                <p style="margin-top: 8px; font-size: 0.85em; color: #6c757d;">
                    다른 후보를 클릭하면 지도 위 경로가 변경됩니다.
                </p>
            </div>
        `;
    }
    
    routeInfoDiv.innerHTML = `
        <div class="route-item">
            <h4>생성된 드로잉 런 경로</h4>
            <p><strong>모양:</strong> ${shapeName}</p>
            <p><strong>길이:</strong> ${(bestRoute.distance / 1000).toFixed(2)} km ${rangeText}</p>
            <p><strong>시작점:</strong> 위도 ${startPoint.lat.toFixed(6)}, 경도 ${startPoint.lon.toFixed(6)}</p>
            <p><strong>포인트 수:</strong> ${bestRoute.coordinates.length}개</p>
            ${isRetry ? '<p style="margin-top: 10px; color: #ff9800; font-size: 0.9em;">⚠️ 5~10km 범위에서 경로를 찾지 못해 10~20km 범위로 자동 확장하여 생성했습니다.</p>' : ''}
            <p style="margin-top: 15px; color: #6c757d; font-size: 0.9em;">
                💡 이 경로를 따라 달리면 ${shapeName} 모양이 그려집니다!
            </p>
            ${retryButtonHtml}
        </div>
        ${candidatesHtml}
    `;
    
    // 재탐색 버튼 이벤트 리스너 추가
    if (!isRetry) {
        const retryButton = document.getElementById('retry-with-longer-range');
        if (retryButton) {
            retryButton.addEventListener('click', async () => {
                await retryWithLongerRange(template, mappedPOINodes, selectedShape, shapeName, startPoint);
            });
        }
    }

    // 후보 클릭 이벤트 등록
    if (candidateRoutes.length > 0) {

            // 후보 클릭 이벤트 등록
            const candidateItems = routeInfoDiv.querySelectorAll('.candidate-item');
            candidateItems.forEach(item => {
                item.addEventListener('click', () => {
                    const idx = parseInt(item.getAttribute('data-candidate-index') || '0', 10);
                    const selected = candidateRoutes[idx];
                    if (!selected) return;

                    // active 클래스 변경
                    candidateItems.forEach(el => el.classList.remove('active'));
                    item.classList.add('active');

                    // 기존 경로 레이어만 제거 (시작 마커는 유지)
                    if (map) {
                        routeLayers.forEach(layer => map.removeLayer(layer));
                    }
                    routeLayers = [];

                    // 새 경로 표시
                    const newRouteLayer = L.polyline(selected.coordinates, {
                        color: '#667eea',
                        weight: 6,
                        opacity: 0.9,
                        lineJoin: 'round',
                        lineCap: 'round'
                    }).addTo(map);

                    const newStartMarker = L.marker([startPoint.lat, startPoint.lon], {
                        icon: L.divIcon({
                            className: 'start-marker',
                            html: '<div style="background: #28a745; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>',
                            iconSize: [20, 20],
                            iconAnchor: [10, 10]
                        })
                    }).addTo(map);

                    newRouteLayer.bindPopup(`
                        <b>드로잉 런 경로 (후보 #${idx + 1})</b><br>
                        모양: ${shapeName}<br>
                        길이: ${(selected.distance / 1000).toFixed(2)} km<br>
                        시작점: 전북대 구정문
                    `);

                    routeLayers.push(newRouteLayer);
                    routeLayers.push(newStartMarker);

                    const newGroup = new L.featureGroup(routeLayers);
                    map.fitBounds(newGroup.getBounds().pad(0.15));
                });
            });
        }
}

// 모양 선택 버튼 이벤트
document.querySelectorAll('.shape-btn-grid').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.shape-btn-grid').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const shapeId = btn.id;
        if (shapeId === 'shape-square') selectedShape = 'square';
        else if (shapeId === 'shape-triangle') selectedShape = 'triangle';
        else if (shapeId === 'shape-heart') selectedShape = 'heart';
        else if (shapeId === 'shape-slate') selectedShape = 'slate';
        else if (shapeId === 'shape-hanok') selectedShape = 'hanok';
        else if (shapeId === 'shape-book') selectedShape = 'book';

    });
});

// 시작점 선택 버튼 이벤트 제거 (시작점 선택 기능 제거됨)

// 임시 시작점 마커 (확인 전)
let tempStartPointMarker = null;

// 지도 클릭 이벤트 제거 (시작점 선택 기능 제거됨)

// 10~20km 재시도 확인 메시지 표시 (사용하지 않음 - 결과 표시 후 버튼으로 대체)
function showRetryConfirmation() {
    return new Promise((resolve) => {
        const confirmationHTML = `
            <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); text-align: center; max-width: 400px;">
                <h3 style="margin: 0 0 15px 0; color: #495057;">경로 생성 완료</h3>
                <p style="margin: 0 0 10px 0; color: #6c757d;">
                    5~10km 범위에서 경로가 생성되었습니다.
                </p>
                <p style="margin: 0 0 20px 0; color: #6c757d; font-size: 0.9em;">
                    10~20km 범위로 더 긴 경로를 생성하시겠습니까?
                </p>
                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button id="confirm-retry-yes" style="padding: 10px 30px; background: #28a745; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">예 (10~20km)</button>
                    <button id="confirm-retry-no" style="padding: 10px 30px; background: #6c757d; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">아니오 (현재 경로 사용)</button>
                </div>
            </div>
        `;
        
        // 기존 확인 메시지 제거
        const existingConfirm = document.getElementById('retry-confirmation');
        if (existingConfirm) {
            existingConfirm.remove();
        }
        
        // 새 확인 메시지 추가
        const confirmationDiv = document.createElement('div');
        confirmationDiv.id = 'retry-confirmation';
        confirmationDiv.style.cssText = 'position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 1000;';
        confirmationDiv.innerHTML = confirmationHTML;
        document.body.appendChild(confirmationDiv);
        
        // 예 버튼 이벤트
        document.getElementById('confirm-retry-yes').addEventListener('click', () => {
            confirmationDiv.remove();
            resolve(true);
        });
        
        // 아니오 버튼 이벤트
        document.getElementById('confirm-retry-no').addEventListener('click', () => {
            confirmationDiv.remove();
            resolve(false);
        });
    });
}

// 시작점 확인 메시지 표시
function showStartPointConfirmation(lat, lon) {
    const confirmationHTML = `
        <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); text-align: center;">
            <h3 style="margin: 0 0 15px 0; color: #495057;">시작점 선택 확인</h3>
            <p style="margin: 0 0 20px 0; color: #6c757d;">
                이곳을 시작지점으로 선택하시겠습니까?<br>
                <small>위도: ${lat.toFixed(6)}, 경도: ${lon.toFixed(6)}</small>
            </p>
            <div style="display: flex; gap: 10px; justify-content: center;">
                <button id="confirm-start-yes" style="padding: 10px 30px; background: #28a745; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">Y (예)</button>
                <button id="confirm-start-no" style="padding: 10px 30px; background: #dc3545; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">N (아니오)</button>
            </div>
        </div>
    `;
    
    // 기존 확인 메시지 제거
    const existingConfirm = document.getElementById('start-point-confirmation');
    if (existingConfirm) {
        existingConfirm.remove();
    }
    
    // 새 확인 메시지 추가
    const confirmationDiv = document.createElement('div');
    confirmationDiv.id = 'start-point-confirmation';
    confirmationDiv.style.cssText = 'position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 1000;';
    confirmationDiv.innerHTML = confirmationHTML;
    document.body.appendChild(confirmationDiv);
    
    // 예 버튼 이벤트
    document.getElementById('confirm-start-yes').addEventListener('click', () => {
        confirmStartPoint(lat, lon);
        confirmationDiv.remove();
    });
    
    // 아니오 버튼 이벤트
    document.getElementById('confirm-start-no').addEventListener('click', () => {
        if (tempStartPointMarker) {
            map.removeLayer(tempStartPointMarker);
            tempStartPointMarker = null;
        }
        confirmationDiv.remove();
    });
}

// 시작점 확인 처리
function confirmStartPoint(lat, lon) {
    selectedStartPoint = { lat, lon };
    
    // 임시 마커 제거
    if (tempStartPointMarker) {
        map.removeLayer(tempStartPointMarker);
        tempStartPointMarker = null;
    }
    
    // 최종 시작점 마커 추가
    if (startPointMarker) {
        map.removeLayer(startPointMarker);
    }
    
    startPointMarker = L.marker([lat, lon], {
        icon: L.divIcon({
            className: 'start-marker',
            html: '<div style="background: #28a745; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        })
    }).addTo(map);
    startPointMarker.bindPopup(`<b>시작점</b><br>위도: ${lat.toFixed(6)}<br>경도: ${lon.toFixed(6)}`).openPopup();
    
    // 선택 모드 종료
    isSelectingStartPoint = false;
    const btn = document.getElementById('select-start-btn');
    btn.textContent = '지도에서 시작점 선택';
    btn.classList.remove('active');
    map.getContainer().style.cursor = '';
    document.getElementById('start-point-info').textContent = 
        `시작점: 위도 ${lat.toFixed(6)}, 경도 ${lon.toFixed(6)}`;
    
    // POI 선택 모드로 전환
    showPOISelectionMode();
}

// POI 선택 모드 활성화
function showPOISelectionMode() {
    if (!poiCatalog || poiCatalog.length === 0) {
        alert('POI 데이터가 없습니다.');
        return;
    }
    
    if (!selectedShape) {
        alert('모양을 먼저 선택해주세요.');
        return;
    }
    
    isPOISelectionMode = true;
    
    // POI 마커 표시
    displayPOIMarkers();
    
    // 범례 표시
    displayPOILegend();
    
    // POI 선택 패널 보이기
    document.querySelector('.poi-selector').style.display = 'block';
    
    // POI 목록 렌더링
    renderPOIList();
    updateCategoryFilter();
}

// POI 마커를 지도에 표시
function displayPOIMarkers() {
    // 기존 POI 마커 제거
    if (poiMarkerLayer) {
        map.removeLayer(poiMarkerLayer);
    }
    poiMarkers.clear();
    
    // 새 마커 레이어 그룹 생성
    poiMarkerLayer = L.layerGroup();
    
    if (!poiCatalog) return;
    
    poiCatalog.forEach(poi => {
        const color = POI_CATEGORY_COLORS[poi.category] || '#808080';
        const poiKey = `${poi.name},${poi.lat},${poi.lon}`;
        const isSelected = selectedPOIs.some(sp => sp.name === poi.name && sp.lat === poi.lat && sp.lon === poi.lon);
        
        // POI 마커 생성 (클릭 범위를 넓히기 위해 더 큰 radius 사용)
        // 선택 시: 하양 배경 + 카테고리 색상 테두리
        const marker = L.circleMarker([poi.lat, poi.lon], {
            radius: isSelected ? 15 : 12, // 클릭 범위 확대
            fillColor: isSelected ? '#FFFFFF' : color,
            color: isSelected ? color : '#FFFFFF', // 선택 시 카테고리 색상 테두리
            weight: isSelected ? 3 : 2,
            opacity: 1,
            fillOpacity: isSelected ? 0.9 : 0.7,
            interactive: true // 클릭 가능하도록 명시
        });
        
        marker.bindPopup(`<b>${poi.name}</b><br>카테고리: ${poi.category}`);
        
        // 마커 클릭 이벤트
        marker.on('click', () => {
            togglePOISelection(poi);
        });
        
        poiMarkerLayer.addLayer(marker);
        poiMarkers.set(poiKey, { marker, poi, isSelected });
    });
    
    poiMarkerLayer.addTo(map);
    
    // 지도 범위 조정 (시작점 + 모든 POI 포함)
    if (selectedStartPoint && poiCatalog.length > 0) {
        const allBounds = poiCatalog.map(p => [p.lat, p.lon]);
        allBounds.push([selectedStartPoint.lat, selectedStartPoint.lon]);
        map.fitBounds(allBounds, { padding: [50, 50], maxZoom: 14 });
    }
}

// POI 선택/해제 토글
function togglePOISelection(poi) {
    const poiKey = `${poi.name},${poi.lat},${poi.lon}`;
    const existing = poiMarkers.get(poiKey);
    if (!existing) return;
    
    const isCurrentlySelected = existing.isSelected;
    
    if (isCurrentlySelected) {
        // 선택 해제
        selectedPOIs = selectedPOIs.filter(sp => !(sp.name === poi.name && sp.lat === poi.lat && sp.lon === poi.lon));
        existing.isSelected = false;
        
        // 마커 스타일 변경 (원래 색상으로)
        const color = POI_CATEGORY_COLORS[poi.category] || '#808080';
        existing.marker.setStyle({
            radius: 12, // 클릭 범위 확대
            fillColor: color,
            color: '#FFFFFF',
            weight: 2,
            fillOpacity: 0.7
        });
    } else {
        // 선택
        selectedPOIs.push(poi);
        existing.isSelected = true;
        
        // 마커 스타일 변경 (하얀색 배경 + 카테고리 색상 테두리)
        const color = POI_CATEGORY_COLORS[poi.category] || '#808080';
        existing.marker.setStyle({
            radius: 15, // 선택 시 더 크게
            fillColor: '#FFFFFF',
            color: color, // 카테고리 색상 테두리
            weight: 3,
            fillOpacity: 0.9
        });
    }
    
    // UI 업데이트
    renderPOIList();
    renderSelectedPOIs();
    validatePOISelection();
}

// POI 범례 표시
function displayPOILegend() {
    const legendEl = document.getElementById('poi-legend');
    const legendItemsEl = legendEl.querySelector('.legend-items');
    
    const legendHTML = Object.entries(POI_CATEGORY_COLORS).map(([category, color]) => {
        return `
            <div class="legend-item">
                <div class="legend-color" style="background-color: ${color};"></div>
                <span>${category}</span>
            </div>
        `;
    }).join('');
    
    legendItemsEl.innerHTML = legendHTML;
    legendEl.classList.remove('hidden');
}

// 선택된 POI 간 거리 검증
function validatePOISelection() {
    if (selectedPOIs.length === 0) {
        document.getElementById('poi-validation').innerHTML = '';
        return;
    }
    
    if (!selectedStartPoint) {
        return;
    }
    
    // 시작점부터 모든 선택된 POI까지의 거리 계산
    let totalDistance = 0;
    const distances = [];
    
    // 시작점 -> 첫 번째 POI
    if (selectedPOIs.length > 0) {
        const distToFirst = calculateDistance(
            selectedStartPoint.lat, selectedStartPoint.lon,
            selectedPOIs[0].lat, selectedPOIs[0].lon
        );
        totalDistance += distToFirst;
        distances.push(distToFirst);
    }
    
    // POI 간 거리
    for (let i = 0; i < selectedPOIs.length - 1; i++) {
        const dist = calculateDistance(
            selectedPOIs[i].lat, selectedPOIs[i].lon,
            selectedPOIs[i + 1].lat, selectedPOIs[i + 1].lon
        );
        totalDistance += dist;
        distances.push(dist);
    }
    
    // 마지막 POI -> 시작점 (폐쇄형 경로)
    if (selectedPOIs.length > 0) {
        const distToStart = calculateDistance(
            selectedPOIs[selectedPOIs.length - 1].lat, selectedPOIs[selectedPOIs.length - 1].lon,
            selectedStartPoint.lat, selectedStartPoint.lon
        );
        totalDistance += distToStart;
        distances.push(distToStart);
    }
    
    // 거리 범위 검증 (직선 거리 기준, 실제 경로는 더 길 수 있으므로 여유있게)
    // 기본 5~10km로 시도하고, 실패 시 자동으로 10~20km로 재시도하므로 검증은 20km까지 허용
    const estimatedRouteDistance = totalDistance * 1.5; // 실제 경로는 직선의 1.5배 가정
    const isValid = estimatedRouteDistance <= FALLBACK_LENGTH_RANGE.max; // 최대 20km까지 허용
    
    const validationEl = document.getElementById('poi-validation');
    if (isValid) {
        const rangeText = estimatedRouteDistance <= DEFAULT_LENGTH_RANGE.max 
            ? `5~10km 범위 내에서 경로 생성 가능합니다.`
            : `10~20km 범위로 자동 확장하여 경로 생성 가능합니다.`;
        validationEl.innerHTML = `
            <p style="color: #28a745; font-weight: 600;">
                ✓ POI 간 직선 거리: ${(totalDistance / 1000).toFixed(2)}km (예상 경로: ${(estimatedRouteDistance / 1000).toFixed(2)}km)
                <br>${rangeText}
            </p>
        `;
    } else {
        validationEl.innerHTML = `
            <p style="color: #dc3545; font-weight: 600;">
                ✗ POI 간 직선 거리: ${(totalDistance / 1000).toFixed(2)}km (예상 경로: ${(estimatedRouteDistance / 1000).toFixed(2)}km)
                <br>거리가 너무 깁니다 (최대 20km). POI를 다시 선택해주세요.
            </p>
        `;
    }
}

// POI 목록 표시 및 선택 기능
function renderPOIList(pois = null, filterText = '', filterCategory = '') {
    const poiListElement = document.getElementById('poi-list');
    if (!poiListElement) {
        // poi-list 요소가 없으면 (메인 페이지에서 제거된 경우) 리턴
        return;
    }
    
    if (!poiCatalog || poiCatalog.length === 0) {
        poiListElement.innerHTML = '<p style="padding: 20px; text-align: center; color: #6c757d;">POI 데이터가 없습니다.</p>';
        return;
    }
    
    const filteredPOIs = (pois || poiCatalog).filter(poi => {
        const matchText = !filterText || poi.name.toLowerCase().includes(filterText.toLowerCase());
        const matchCategory = !filterCategory || poi.category === filterCategory;
        return matchText && matchCategory;
    });
    
    const poiListHTML = filteredPOIs.map(poi => {
        const isSelected = selectedPOIs.some(sp => sp.name === poi.name && sp.lat === poi.lat && sp.lon === poi.lon);
        return `
            <div class="poi-item ${isSelected ? 'selected' : ''}" data-poi-name="${poi.name}" data-poi-lat="${poi.lat}" data-poi-lon="${poi.lon}">
                <div class="poi-item-info">
                    <div class="poi-item-name">${poi.name}</div>
                    <div class="poi-item-category">${poi.category}</div>
                </div>
                <input type="checkbox" class="poi-checkbox" ${isSelected ? 'checked' : ''}>
            </div>
        `;
    }).join('');
    
    poiListElement.innerHTML = poiListHTML || '<p style="padding: 20px; text-align: center; color: #6c757d;">검색 결과가 없습니다.</p>';
    
    // 체크박스 이벤트
    document.querySelectorAll('.poi-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const item = e.target.closest('.poi-item');
            const poi = {
                name: item.getAttribute('data-poi-name'),
                lat: parseFloat(item.getAttribute('data-poi-lat')),
                lon: parseFloat(item.getAttribute('data-poi-lon')),
                category: item.querySelector('.poi-item-category').textContent
            };
            
            if (e.target.checked) {
                if (!selectedPOIs.some(sp => sp.name === poi.name && sp.lat === poi.lat && sp.lon === poi.lon)) {
                    selectedPOIs.push(poi);
                }
                item.classList.add('selected');
            } else {
                selectedPOIs = selectedPOIs.filter(sp => !(sp.name === poi.name && sp.lat === poi.lat && sp.lon === poi.lon));
                item.classList.remove('selected');
            }
            
            renderSelectedPOIs();
            validatePOISelection();
            
            // 지도 마커 업데이트
            const poiKey = `${poi.name},${poi.lat},${poi.lon}`;
            const existing = poiMarkers.get(poiKey);
            if (existing) {
                togglePOISelection(poi);
            }
        });
    });
    
    // POI 아이템 클릭 이벤트
    document.querySelectorAll('.poi-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('poi-checkbox')) return;
            const checkbox = item.querySelector('.poi-checkbox');
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change'));
        });
    });
}

// 선택된 POI 목록 표시
function renderSelectedPOIs() {
    document.getElementById('selected-count').textContent = selectedPOIs.length;
    
    const selectedHTML = selectedPOIs.map((poi, idx) => `
        <div class="selected-poi-tag">
            <span>${poi.name}</span>
            <button class="remove-btn" data-index="${idx}">×</button>
        </div>
    `).join('');
    
    document.getElementById('selected-poi-list').innerHTML = selectedHTML || '<p style="color: #6c757d; font-size: 0.9em;">선택된 장소가 없습니다.</p>';
    
    // 제거 버튼 이벤트
    document.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.getAttribute('data-index'));
            const poi = selectedPOIs[idx];
            selectedPOIs.splice(idx, 1);
            renderSelectedPOIs();
            renderPOIList();
            validatePOISelection();
            
            // 지도 마커 업데이트
            if (poi) {
                const poiKey = `${poi.name},${poi.lat},${poi.lon}`;
                const existing = poiMarkers.get(poiKey);
                if (existing) {
                existing.isSelected = false;
                const color = POI_CATEGORY_COLORS[poi.category] || '#808080';
                existing.marker.setStyle({
                    radius: 12, // 클릭 범위 확대
                    fillColor: color,
                    color: '#FFFFFF',
                    weight: 2,
                    fillOpacity: 0.7
                });
                }
            }
        });
    });
}

// POI 검색 및 필터
const poiSearchElement = document.getElementById('poi-search');
if (poiSearchElement) {
    poiSearchElement.addEventListener('input', (e) => {
        const filterText = e.target.value;
        const filterCategory = document.getElementById('poi-category-filter')?.value || '';
        renderPOIList(null, filterText, filterCategory);
    });
}

// 카테고리 필터 업데이트 및 이벤트
function updateCategoryFilter() {
    if (!poiCatalog) return;
    
    const filterSelect = document.getElementById('poi-category-filter');
    if (!filterSelect) return; // 요소가 없으면 리턴
    
    const categories = [...new Set(poiCatalog.map(poi => poi.category))].sort();
    
    filterSelect.innerHTML = '<option value="">전체 카테고리</option>' +
        categories.map(cat => `<option value="${cat}">${cat}</option>`).join('');
    
    filterSelect.addEventListener('change', (e) => {
        const filterText = document.getElementById('poi-search')?.value || '';
        renderPOIList(null, filterText, e.target.value);
    });
}

// 검색 버튼 이벤트
const searchBtnElement = document.getElementById('search-btn');
if (searchBtnElement) {
    searchBtnElement.addEventListener('click', generateRoute);
}

// 선택된 테마 저장 변수
let selectedTheme = 'cultural'; // 기본값: 문화공간

// 시작 화면 숨기기 함수
// 시작 화면을 숨기고 지역 선택 화면을 표시
function hideStartScreen() {
    console.log('hideStartScreen 함수 호출됨');
    const startScreen = document.getElementById('start-screen');
    const regionSelectScreen = document.getElementById('region-select-screen');
    
    if (startScreen && regionSelectScreen) {
        startScreen.classList.add('hidden');
        
        // 시작 화면이 완전히 사라진 후 지역 선택 화면 표시
        setTimeout(() => {
            regionSelectScreen.classList.remove('hidden');
        }, 500); // CSS transition 시간과 맞춤
    }
}

// 지역 선택 화면 숨기기 함수
// 지역 선택 화면을 숨기고 테마 선택 화면을 표시
function hideRegionSelectScreen() {
    const regionSelectScreen = document.getElementById('region-select-screen');
    const themeSelectScreen = document.getElementById('theme-select-screen');
    
    if (regionSelectScreen && themeSelectScreen) {
        regionSelectScreen.classList.add('hidden');
        
        // 지역 선택 화면이 완전히 사라진 후 테마 선택 화면 표시
        setTimeout(() => {
            themeSelectScreen.classList.remove('hidden');
        }, 500); // CSS transition 시간과 맞춤
    }
}

// 테마 선택 화면 숨기기 함수
// 테마 선택 화면을 숨기고 POI 선택 화면을 표시
function hideThemeSelectScreen() {
    const themeSelectScreen = document.getElementById('theme-select-screen');
    const poiSelectScreen = document.getElementById('poi-select-screen');
    
    if (themeSelectScreen && poiSelectScreen) {
        themeSelectScreen.classList.add('hidden');
        
        // 테마 선택 화면이 완전히 사라진 후 POI 선택 화면 표시
        setTimeout(() => {
            poiSelectScreen.classList.remove('hidden');
            // POI 선택 화면용 지도 초기화
            initPOISelectMap();
            // 선택된 테마에 맞는 카테고리 버튼 활성화
            updatePOICategoryButtons(selectedTheme);
            // 선택된 테마에 따라 POI 목록 렌더링
            renderPOISelectList(selectedTheme);
            // 기존 선택된 POI의 마커 표시 및 거리 정보 업데이트
            setTimeout(() => {
                selectedPOIs.forEach(poi => {
                    addPOISelectMarker(poi);
                });
                updatePOIDistanceInfo();
            }, 200);
        }, 500); // CSS transition 시간과 맞춤
    }
}

// POI 선택 화면용 지도 초기화
function initPOISelectMap() {
    const mapContainer = document.getElementById('poi-select-map');
    if (!mapContainer) return;
    
    // 이미 초기화되어 있으면 리턴
    if (poiSelectMap) {
        // 지도 크기 조정 (컨테이너 크기 변경 대응)
        setTimeout(() => {
            poiSelectMap.invalidateSize();
        }, 100);
        return;
    }
    
    // POI 선택 화면용 지도 생성
    poiSelectMap = L.map('poi-select-map').setView([35.8242, 127.1480], 13);
    
    // OpenStreetMap 타일 레이어 추가
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(poiSelectMap);
    
    // 지도가 완전히 로드된 후 크기 조정
    poiSelectMap.whenReady(() => {
        setTimeout(() => {
            poiSelectMap.invalidateSize();
        }, 100);
    });
    
    console.log('POI 선택 화면용 지도 초기화 완료');
}

// POI 선택 화면에서 선택된 POI의 최소 직선거리 계산
// 모든 POI 간의 최단 경로를 근사하여 계산 (Nearest Neighbor 알고리즘 사용)
function calculateMinPOIDistance() {
    if (selectedPOIs.length < 2) {
        return 0;
    }
    
    if (selectedPOIs.length === 2) {
        // POI가 2개면 두 점 간의 거리
        return calculateDistance(
            selectedPOIs[0].lat, selectedPOIs[0].lon,
            selectedPOIs[1].lat, selectedPOIs[1].lon
        );
    }
    
    // Nearest Neighbor 알고리즘으로 최단 경로 근사
    const unvisited = [...selectedPOIs];
    const path = [];
    
    // 시작점 선택 (첫 번째 POI)
    let current = unvisited.shift();
    path.push(current);
    
    // 가장 가까운 POI를 순차적으로 선택
    while (unvisited.length > 0) {
        let nearest = null;
        let nearestDistance = Infinity;
        let nearestIndex = -1;
        
        for (let i = 0; i < unvisited.length; i++) {
            const distance = calculateDistance(
                current.lat, current.lon,
                unvisited[i].lat, unvisited[i].lon
            );
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = unvisited[i];
                nearestIndex = i;
            }
        }
        
        if (nearest) {
            path.push(nearest);
            unvisited.splice(nearestIndex, 1);
            current = nearest;
        }
    }
    
    // 경로의 총 거리 계산
    let totalDistance = 0;
    for (let i = 0; i < path.length - 1; i++) {
        totalDistance += calculateDistance(
            path[i].lat, path[i].lon,
            path[i + 1].lat, path[i + 1].lon
        );
    }
    
    return totalDistance;
}

// POI 선택 화면에서 거리 정보 업데이트
function updatePOIDistanceInfo() {
    const distanceInfoSection = document.getElementById('poi-distance-info-section');
    const distanceValue = document.getElementById('poi-distance-value');
    const distanceWarningSection = document.getElementById('poi-distance-warning-section');
    
    if (selectedPOIs.length < 2) {
        // POI가 2개 미만이면 거리 정보 숨김
        if (distanceInfoSection) distanceInfoSection.classList.add('hidden');
        if (distanceWarningSection) distanceWarningSection.classList.add('hidden');
        return;
    }
    
    // 최소 직선거리 계산
    const minDistance = calculateMinPOIDistance();
    const distanceKm = minDistance / 1000;
    
    // 거리 정보 표시
    if (distanceInfoSection && distanceValue) {
        distanceInfoSection.classList.remove('hidden');
        distanceValue.textContent = distanceKm.toFixed(2);
    }
    
    // 10km 초과 시 경고 메시지 표시
    if (distanceWarningSection) {
        if (distanceKm > 10) {
            distanceWarningSection.classList.remove('hidden');
        } else {
            distanceWarningSection.classList.add('hidden');
        }
    }
}

// 테마 선택 화면에서 지역 선택 화면으로 돌아가기
function goBackToRegionSelectScreen() {
    const themeSelectScreen = document.getElementById('theme-select-screen');
    const regionSelectScreen = document.getElementById('region-select-screen');
    
    if (themeSelectScreen && regionSelectScreen) {
        themeSelectScreen.classList.add('hidden');
        
        // 테마 선택 화면이 완전히 사라진 후 지역 선택 화면 표시
        setTimeout(() => {
            regionSelectScreen.classList.remove('hidden');
        }, 500);
    }
}

// POI 선택 화면 숨기기 함수
// POI 선택 화면을 숨기고 시작 위치 선택 화면을 표시
async function hidePOISelectScreen() {
    console.log('hidePOISelectScreen 함수 호출됨');
    const poiSelectScreen = document.getElementById('poi-select-screen');
    const startLocationScreen = document.getElementById('start-location-screen');
    
    if (!poiSelectScreen) {
        console.error('POI 선택 화면을 찾을 수 없습니다.');
        return;
    }
    
    if (!startLocationScreen) {
        console.error('시작 위치 선택 화면을 찾을 수 없습니다.');
        return;
    }
    
    console.log('POI 선택 화면 숨김 처리 중...');
    poiSelectScreen.classList.add('hidden');
    
    // POI 선택 화면이 완전히 사라진 후 시작 위치 선택 화면 표시
    setTimeout(async () => {
        console.log('시작 위치 선택 화면 표시 중...');
        startLocationScreen.classList.remove('hidden');
        
        // 시작 위치 선택 화면 초기화
        try {
            console.log('시작 위치 선택 화면 초기화 시작...');
            await initStartLocationScreen();
            console.log('시작 위치 선택 화면 초기화 완료');
        } catch (error) {
            console.error('시작 위치 선택 화면 초기화 오류:', error);
            // 에러가 발생해도 화면은 표시하고 기본 지도 초기화
            try {
                initStartLocationMap();
                displaySelectedPOIMarkers();
            } catch (mapError) {
                console.error('지도 초기화 오류:', mapError);
            }
        }
    }, 500); // CSS transition 시간과 맞춤
}

// 시작 위치 선택 화면 초기화
async function initStartLocationScreen() {
    // HTTPS 체크 (HTTP 환경에서는 geolocation이 차단될 수 있음)
    // window.isSecureContext는 브라우저 API, 또는 프로토콜이 https인지 확인
    const isSecure = window.isSecureContext || window.location.protocol === 'https:';
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const isHttp = window.location.protocol === 'http:';
    
    // HTTP 환경이고 localhost가 아닌 경우 GPS 사용 안 함
    if (isHttp && !isLocalhost && !isSecure) {
        console.warn('HTTP 환경에서는 GPS 기능이 제한됩니다. 위치 정보 없이 진행합니다.');
        // HTTP 환경에서는 위치 정보 없이 진행 (알림 없이 조용히 진행)
        initStartLocationMap();
        displaySelectedPOIMarkers();
        return;
    }
    
    // HTTPS 또는 localhost 환경에서만 GPS 권한 요청 및 위치 가져오기
    try {
        // 먼저 위치 정보를 가져오려고 시도 (권한 요청 팝업이 자동으로 표시됨)
        await getUserCurrentLocation();
        
        // 위치 정보를 성공적으로 가져왔으면 지도 초기화
        initStartLocationMap();
        
        // 선택된 POI 마커 표시
        displaySelectedPOIMarkers();
        
    } catch (error) {
        console.error('GPS 초기화 오류:', error);
        console.error('에러 코드:', error.code);
        console.error('에러 메시지:', error.message);
        
        // 에러 코드 확인
        // PERMISSION_DENIED (1): 사용자가 권한 거부 또는 HTTP 환경에서 차단
        // POSITION_UNAVAILABLE (2): 위치 정보를 사용할 수 없음
        // TIMEOUT (3): 요청 시간 초과
        if (error.code === 1) {
            // 권한 거부 또는 HTTP 환경에서 차단
            const errorMsg = (error.message || '').toLowerCase();
            
            // HTTP 환경에서 차단된 경우인지 확인
            // 에러 메시지에 secure context 관련 내용이 있거나, HTTP 프로토콜인 경우
            if (errorMsg.includes('secure context') || errorMsg.includes('https') || 
                errorMsg.includes('not allowed') || isHttp) {
                // HTTP 환경에서 차단된 경우 - 위치 정보 없이 진행
                console.log('HTTP 환경에서 GPS가 차단되었습니다. 위치 정보 없이 진행합니다.');
                initStartLocationMap();
                displaySelectedPOIMarkers();
            } else {
                // HTTPS 환경에서 사용자가 권한을 거부한 경우에만 이전 화면으로 돌아감
                console.log('사용자가 GPS 권한을 거부했습니다.');
                alert('GPS 권한이 필요합니다. 이전 화면으로 돌아갑니다.');
                goBackToPOISelectScreen();
            }
        } else {
            // 다른 에러 (타임아웃 등)는 위치 정보 없이 진행
            console.log('위치 정보를 가져올 수 없지만 계속 진행합니다.');
            // 위치 정보 없이 지도 초기화 (기본 위치 사용)
            initStartLocationMap();
            displaySelectedPOIMarkers();
        }
    }
}

// 사용자 현재 위치 가져오기
function getUserCurrentLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            const error = new Error('Geolocation이 지원되지 않습니다.');
            error.code = 0;
            reject(error);
            return;
        }
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                let lat = position.coords.latitude;
                let lon = position.coords.longitude;
                
                // 전주시 바운더리 확인
                if (lat < JEONJU_BOUNDS.minLat || lat > JEONJU_BOUNDS.maxLat ||
                    lon < JEONJU_BOUNDS.minLon || lon > JEONJU_BOUNDS.maxLon) {
                    console.log('GPS 위치가 전주시 밖입니다. 전북대학교 신정문으로 고정합니다.');
                    // 전주시 밖이면 전북대학교 신정문으로 고정
                    userLocation = {
                        lat: JEONBUK_UNIV_NEW_GATE.lat,
                        lon: JEONBUK_UNIV_NEW_GATE.lon
                    };
                } else {
                    userLocation = {
                        lat: lat,
                        lon: lon
                    };
                }
                
                console.log('사용자 현재 위치:', userLocation);
                resolve(userLocation);
            },
            (error) => {
                console.error('위치 가져오기 오류:', error.code, error.message);
                console.error('에러 상세:', error);
                // 에러 객체에 code 속성이 없을 수 있으므로 보장
                if (!error.code) {
                    error.code = 0;
                }
                // 에러 메시지도 보장
                if (!error.message) {
                    error.message = '';
                }
                reject(error);
            },
            {
                enableHighAccuracy: false, // 정확도 낮춰서 빠르게 응답 (모바일에서 권한 팝업 표시 시간 확보)
                timeout: 15000, // 타임아웃을 15초로 증가 (모바일에서 권한 팝업 표시 시간 확보)
                maximumAge: 60000 // 1분 이내 캐시된 위치 정보 사용 가능
            }
        );
    });
}

// 시작 위치 선택 화면용 지도 초기화
function initStartLocationMap() {
    const mapContainer = document.getElementById('start-location-map');
    if (!mapContainer) return;
    
    // 이미 초기화되어 있으면 리턴
    if (startLocationMap) {
        setTimeout(() => {
            startLocationMap.invalidateSize();
        }, 100);
        return;
    }
    
    // 사용자 위치 또는 전주시 중심으로 지도 생성
    // GPS 위치가 전주시 밖이면 전북대학교 신정문으로 고정
    let centerLat, centerLon;
    if (userLocation) {
        // 전주시 바운더리 확인
        if (userLocation.lat < JEONJU_BOUNDS.minLat || userLocation.lat > JEONJU_BOUNDS.maxLat ||
            userLocation.lon < JEONJU_BOUNDS.minLon || userLocation.lon > JEONJU_BOUNDS.maxLon) {
            // 전주시 밖이면 전북대학교 신정문으로 고정
            centerLat = JEONBUK_UNIV_NEW_GATE.lat;
            centerLon = JEONBUK_UNIV_NEW_GATE.lon;
            // 사용자 위치도 신정문으로 업데이트
            userLocation = { lat: centerLat, lon: centerLon };
        } else {
            centerLat = userLocation.lat;
            centerLon = userLocation.lon;
        }
    } else {
        centerLat = 35.8242;
        centerLon = 127.1480;
    }
    
    startLocationMap = L.map('start-location-map').setView([centerLat, centerLon], 14);
    
    // OpenStreetMap 타일 레이어 추가
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(startLocationMap);
    
    // 사용자 현재 위치 마커 추가
    if (userLocation) {
        addUserLocationMarker();
        // 사용자 위치를 초기 시작 위치로 설정
        selectStartLocation(userLocation.lat, userLocation.lon);
    }
    
    // 지도 클릭 시 시작 위치 선택
    startLocationMap.on('click', (e) => {
        selectStartLocation(e.latlng.lat, e.latlng.lng);
    });
    
    // 지도가 완전히 로드된 후 크기 조정
    startLocationMap.whenReady(() => {
        setTimeout(() => {
            startLocationMap.invalidateSize();
            // 선택된 POI와 사용자 위치가 모두 보이도록 범위 조정
            adjustStartLocationMapBounds();
        }, 100);
    });
    
    console.log('시작 위치 선택 화면용 지도 초기화 완료');
}

// 사용자 현재 위치 마커 추가
function addUserLocationMarker() {
    if (!startLocationMap || !userLocation) return;
    
    // 기존 마커 제거
    if (userLocationMarker) {
        startLocationMap.removeLayer(userLocationMarker);
    }
    
    // 사용자 위치 마커 생성 (파란색 원형)
    userLocationMarker = L.circleMarker([userLocation.lat, userLocation.lon], {
        radius: 10,
        fillColor: '#4A90E2',
        color: '#fff',
        weight: 3,
        opacity: 1,
        fillOpacity: 0.8
    }).addTo(startLocationMap);
    
    userLocationMarker.bindPopup('<b>내 현재 위치</b>').openPopup();
}

// 선택된 POI 마커 표시
function displaySelectedPOIMarkers() {
    if (!startLocationMap || !selectedPOIs || selectedPOIs.length === 0) return;
    
    // 기존 POI 마커 제거
    startLocationMarkers.forEach(({ marker }) => {
        startLocationMap.removeLayer(marker);
    });
    startLocationMarkers.clear();
    
    // 선택된 POI 마커 추가
    selectedPOIs.forEach(poi => {
        const categoryColor = POI_CATEGORY_COLORS[poi.category] || '#808080';
        const poiImagePath = `images/poi/${poi.name}.jpg`;
        
        // 역물방울 모양 마커 생성
        const teardropIcon = L.divIcon({
            className: 'poi-teardrop-marker',
            html: `
                <div style="position: relative; width: 30px; height: 40px;">
                    <svg width="30" height="40" viewBox="0 0 30 40" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); position: absolute; top: 0; left: 0;">
                        <path d="M15 0 C6.716 0 0 6.716 0 15 C0 20 5 25 10 30 L15 40 L20 30 C25 25 30 20 30 15 C30 6.716 23.284 0 15 0 Z" 
                              fill="${categoryColor}" 
                              stroke="#fff" 
                              stroke-width="2"/>
                    </svg>
                    <div class="poi-marker-image" style="position: absolute; top: 2px; left: 50%; transform: translateX(-50%); width: 20px; height: 20px; border-radius: 50%; overflow: hidden; border: 2px solid white; background: white;">
                        <img src="${poiImagePath}" alt="${poi.name}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none';">
                    </div>
                </div>
            `,
            iconSize: [30, 40],
            iconAnchor: [15, 40],
            popupAnchor: [0, -40]
        });
        
        const marker = L.marker([poi.lat, poi.lon], {
            icon: teardropIcon
        }).addTo(startLocationMap);
        
        marker.bindPopup(`<b>${poi.name}</b><br>카테고리: ${poi.category}`);
        
        startLocationMarkers.set(`${poi.name},${poi.lat},${poi.lon}`, { marker, poi });
    });
    
    // 지도 범위 조정
    adjustStartLocationMapBounds();
}

// 시작 위치 선택
function selectStartLocation(lat, lon) {
    selectedStartLocation = { lat, lon };
    
    // 기존 선택 위치 마커 제거
    if (selectedStartLocationMarker) {
        startLocationMap.removeLayer(selectedStartLocationMarker);
    }
    
    // 선택된 시작 위치 마커 추가 (초록색 원형)
    selectedStartLocationMarker = L.circleMarker([lat, lon], {
        radius: 12,
        fillColor: '#28a745',
        color: '#fff',
        weight: 3,
        opacity: 1,
        fillOpacity: 0.9
    }).addTo(startLocationMap);
    
    selectedStartLocationMarker.bindPopup('<b>선택된 시작 위치</b>').openPopup();
    
    // 위치 정보 업데이트
    updateSelectedLocationText(lat, lon);
}

// 선택된 위치 텍스트 업데이트
function updateSelectedLocationText(lat, lon) {
    const locationText = document.getElementById('selected-location-text');
    if (locationText) {
        locationText.textContent = `위도: ${lat.toFixed(6)}, 경도: ${lon.toFixed(6)}`;
    }
}

// 시작 위치 선택 화면 지도 범위 조정
function adjustStartLocationMapBounds() {
    if (!startLocationMap) return;
    
    const bounds = [];
    
    // 선택된 POI 추가
    startLocationMarkers.forEach(({ poi }) => {
        bounds.push([poi.lat, poi.lon]);
    });
    
    // 사용자 위치 추가
    if (userLocation) {
        bounds.push([userLocation.lat, userLocation.lon]);
    }
    
    // 선택된 시작 위치 추가
    if (selectedStartLocation) {
        bounds.push([selectedStartLocation.lat, selectedStartLocation.lon]);
    }
    
    if (bounds.length > 0) {
        startLocationMap.fitBounds(bounds, {
            padding: [50, 50],
            maxZoom: 15
        });
    }
}

// 메인 화면에서 시작 위치 선택 화면으로 돌아가기
function goBackToStartLocationScreen() {
    const mainContent = document.getElementById('main-content');
    const startLocationScreen = document.getElementById('start-location-screen');
    
    if (mainContent && startLocationScreen) {
        mainContent.classList.add('hidden');
        
        setTimeout(() => {
            startLocationScreen.classList.remove('hidden');
            // 시작 위치 선택 화면 지도 크기 조정
            if (startLocationMap) {
                setTimeout(() => {
                    startLocationMap.invalidateSize();
                }, 100);
            }
        }, 500);
    }
}

// 시작 위치 선택 화면에서 POI 선택 화면으로 돌아가기
function goBackToPOISelectScreen() {
    const startLocationScreen = document.getElementById('start-location-screen');
    const poiSelectScreen = document.getElementById('poi-select-screen');
    
    if (startLocationScreen && poiSelectScreen) {
        startLocationScreen.classList.add('hidden');
        
        setTimeout(() => {
            poiSelectScreen.classList.remove('hidden');
            // 마커 정리
            clearStartLocationMarkers();
        }, 500);
    }
}

// 시작 위치 선택 화면 마커 정리
function clearStartLocationMarkers() {
    if (!startLocationMap) return;
    
    startLocationMarkers.forEach(({ marker }) => {
        startLocationMap.removeLayer(marker);
    });
    startLocationMarkers.clear();
    
    if (userLocationMarker) {
        startLocationMap.removeLayer(userLocationMarker);
        userLocationMarker = null;
    }
    
    if (selectedStartLocationMarker) {
        startLocationMap.removeLayer(selectedStartLocationMarker);
        selectedStartLocationMarker = null;
    }
}

// 시작 위치 선택 확인 창 표시
function showStartLocationConfirmation() {
    if (!selectedStartLocation) {
        alert('시작 위치를 선택해주세요.');
        return;
    }
    
    // 확인 다이얼로그 표시
    const confirmMessage = `선택한 위치를 시작 위치로 지정하시겠습니까?\n\n위도: ${selectedStartLocation.lat.toFixed(6)}\n경도: ${selectedStartLocation.lon.toFixed(6)}`;
    
    if (confirm(confirmMessage)) {
        // 확인 시 시작 위치 저장하고 메인 화면으로 이동
        selectedStartPoint = selectedStartLocation;
        hideStartLocationScreen();
    }
}

// 시작 위치 선택 화면에서 메인 화면으로 이동
function hideStartLocationScreen() {
    const startLocationScreen = document.getElementById('start-location-screen');
    const mainContent = document.getElementById('main-content');
    
    if (startLocationScreen && mainContent) {
        startLocationScreen.classList.add('hidden');
        
        setTimeout(() => {
            mainContent.classList.remove('hidden');
            // 마커 정리
            clearStartLocationMarkers();
            // 메인 화면 지도 초기화 및 표시
            initMainScreenMap();
        }, 500);
    }
}

// 메인 화면 지도 초기화 및 표시
function initMainScreenMap() {
    // 지도가 아직 초기화되지 않았으면 초기화
    if (!map) {
        initMainMap();
    }
    
    // 지도 크기 조정
    setTimeout(() => {
        if (map) {
            map.invalidateSize();
        }
        
        if (!map) {
            console.error('지도가 초기화되지 않았습니다.');
            return;
        }
        
        // 선택한 시작포인트와 POI가 모두 보이도록 지도 범위 조정
        if (selectedStartPoint && selectedPOIs && selectedPOIs.length > 0) {
            const bounds = [];
            
            // 시작점 추가
            bounds.push([selectedStartPoint.lat, selectedStartPoint.lon]);
            
            // 선택된 POI 추가
            selectedPOIs.forEach(poi => {
                bounds.push([poi.lat, poi.lon]);
            });
            
            // 모든 포인트가 보이도록 범위 조정
            map.fitBounds(bounds, {
                padding: [50, 50],
                maxZoom: 14
            });
            
            // 시작점 마커 표시
            if (startPointMarker) {
                map.removeLayer(startPointMarker);
            }
            startPointMarker = L.marker([selectedStartPoint.lat, selectedStartPoint.lon], {
                icon: L.divIcon({
                    className: 'start-marker',
                    html: '<div style="background: #28a745; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>',
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                })
            }).addTo(map);
            startPointMarker.bindPopup(`<b>시작점</b><br>위도: ${selectedStartPoint.lat.toFixed(6)}<br>경도: ${selectedStartPoint.lon.toFixed(6)}`);
            
            // 선택된 POI 마커 표시
            displaySelectedPOIMarkersOnMainMap();
        } else if (selectedStartPoint) {
            // 시작점만 있는 경우
            map.setView([selectedStartPoint.lat, selectedStartPoint.lon], 14);
            
            if (startPointMarker) {
                map.removeLayer(startPointMarker);
            }
            startPointMarker = L.marker([selectedStartPoint.lat, selectedStartPoint.lon], {
                icon: L.divIcon({
                    className: 'start-marker',
                    html: '<div style="background: #28a745; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>',
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                })
            }).addTo(map);
            startPointMarker.bindPopup(`<b>시작점</b><br>위도: ${selectedStartPoint.lat.toFixed(6)}<br>경도: ${selectedStartPoint.lon.toFixed(6)}`);
        }
    }, 100);
}

// 메인 화면에 선택된 POI 마커 표시
function displaySelectedPOIMarkersOnMainMap() {
    if (!selectedPOIs || selectedPOIs.length === 0) return;
    
    // 기존 POI 마커 제거
    if (poiMarkerLayer) {
        map.removeLayer(poiMarkerLayer);
    }
    poiMarkerLayer = L.layerGroup();
    poiMarkers.clear();
    
    // 선택된 POI 마커 추가
    selectedPOIs.forEach(poi => {
        const categoryColor = POI_CATEGORY_COLORS[poi.category] || '#808080';
        const poiImagePath = `images/poi/${poi.name}.jpg`;
        
        // 역물방울 모양 마커 생성
        const teardropIcon = L.divIcon({
            className: 'poi-teardrop-marker',
            html: `
                <div style="position: relative; width: 30px; height: 40px;">
                    <svg width="30" height="40" viewBox="0 0 30 40" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); position: absolute; top: 0; left: 0;">
                        <path d="M15 0 C6.716 0 0 6.716 0 15 C0 20 5 25 10 30 L15 40 L20 30 C25 25 30 20 30 15 C30 6.716 23.284 0 15 0 Z" 
                              fill="${categoryColor}" 
                              stroke="#fff" 
                              stroke-width="2"/>
                    </svg>
                    <div class="poi-marker-image" style="position: absolute; top: 2px; left: 50%; transform: translateX(-50%); width: 20px; height: 20px; border-radius: 50%; overflow: hidden; border: 2px solid white; background: white;">
                        <img src="${poiImagePath}" alt="${poi.name}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none';">
                    </div>
                </div>
            `,
            iconSize: [30, 40],
            iconAnchor: [15, 40],
            popupAnchor: [0, -40]
        });
        
        const marker = L.marker([poi.lat, poi.lon], {
            icon: teardropIcon
        }).addTo(poiMarkerLayer);
        
        marker.bindPopup(`<b>${poi.name}</b><br>카테고리: ${poi.category}`);
        
        poiMarkers.set(`${poi.name},${poi.lat},${poi.lon}`, { marker, poi, isSelected: true });
    });
    
    poiMarkerLayer.addTo(map);
}

// POI 선택 화면에서 테마 선택 화면으로 돌아가기
function goBackToThemeSelectScreen() {
    const poiSelectScreen = document.getElementById('poi-select-screen');
    const themeSelectScreen = document.getElementById('theme-select-screen');
    
    if (poiSelectScreen && themeSelectScreen) {
        poiSelectScreen.classList.add('hidden');
        
        // POI 선택 화면이 완전히 사라진 후 테마 선택 화면 표시
        setTimeout(() => {
            themeSelectScreen.classList.remove('hidden');
            // POI 선택 화면의 마커 정리 (메모리 절약)
            clearPOISelectMarkers();
        }, 500);
    }
}

// POI 선택 화면에서 카테고리 버튼 활성화 상태 업데이트
function updatePOICategoryButtons(categoryKey) {
    // 모든 버튼의 active 클래스 제거
    document.querySelectorAll('.poi-category-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // 선택된 테마에 해당하는 버튼 활성화
    const activeBtn = document.querySelector(`.poi-category-btn[data-category="${categoryKey}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
    
    // 현재 카테고리 업데이트
    currentPOICategory = categoryKey;
}

// POI 선택 화면에서 POI 목록 렌더링
// categoryKey: 'all', 'historical', 'cultural', 'food'
function renderPOISelectList(categoryKey) {
    if (!poiCatalog || poiCatalog.length === 0) {
        document.getElementById('poi-select-list').innerHTML = '<p style="padding: 20px; text-align: center; color: #6c757d;">POI 데이터가 없습니다.</p>';
        return;
    }
    
    // 선택된 카테고리에 해당하는 POI 필터링
    const mapping = POI_CATEGORY_MAPPING[categoryKey];
    if (!mapping) {
        console.error(`알 수 없는 카테고리: ${categoryKey}`);
        return;
    }
    
    const filteredPOIs = poiCatalog.filter(poi => 
        mapping.categories.includes(poi.category)
    );
    
    // POI 목록 HTML 생성
    const poiListHTML = filteredPOIs.map(poi => {
        const isSelected = selectedPOIs.some(sp => 
            sp.name === poi.name && sp.lat === poi.lat && sp.lon === poi.lon
        );
        const categoryColor = POI_CATEGORY_COLORS[poi.category] || '#6c757d';
        
        // POI 이미지 경로 (사용자가 추가할 이미지)
        const poiImagePath = `images/poi/${poi.name}.jpg`; // 또는 .png
        
        return `
            <div class="poi-select-item ${isSelected ? 'selected' : ''}" 
                 data-poi-name="${poi.name}" 
                 data-poi-lat="${poi.lat}" 
                 data-poi-lon="${poi.lon}"
                 data-poi-category="${poi.category}">
                <div class="poi-select-item-image">
                    <img src="${poiImagePath}" alt="${poi.name}" onerror="this.style.display='none';">
                </div>
                <div class="poi-select-item-content">
                    <div class="poi-select-item-name">${poi.name}</div>
                    <span class="poi-select-item-category" style="background: ${categoryColor};">
                        ${poi.category}
                    </span>
                </div>
                <div class="poi-select-item-check">✓</div>
            </div>
        `;
    }).join('');
    
    document.getElementById('poi-select-list').innerHTML = 
        poiListHTML || '<p style="padding: 20px; text-align: center; color: #6c757d;">선택 가능한 장소가 없습니다.</p>';
    
    // POI 아이템 클릭 이벤트 등록
    document.querySelectorAll('.poi-select-item').forEach(item => {
        item.addEventListener('click', () => {
            togglePOISelectItem(item);
        });
    });
    
    // 선택된 POI의 마커 다시 표시
    selectedPOIs.forEach(poi => {
        const markerKey = `${poi.name},${poi.lat},${poi.lon}`;
        if (!poiSelectMarkers.has(markerKey)) {
            addPOISelectMarker(poi);
        }
    });
    
    // 선택된 POI 개수 업데이트
    updatePOISelectedCount();
    // 거리 정보 업데이트
    updatePOIDistanceInfo();
}

// POI 선택 아이템 토글
function togglePOISelectItem(item) {
    const poiName = item.getAttribute('data-poi-name');
    const poiLat = parseFloat(item.getAttribute('data-poi-lat'));
    const poiLon = parseFloat(item.getAttribute('data-poi-lon'));
    const poiCategory = item.getAttribute('data-poi-category');
    
    const poi = {
        name: poiName,
        lat: poiLat,
        lon: poiLon,
        category: poiCategory
    };
    
    const isCurrentlySelected = item.classList.contains('selected');
    const markerKey = `${poiName},${poiLat},${poiLon}`;
    
    if (isCurrentlySelected) {
        // 선택 해제
        selectedPOIs = selectedPOIs.filter(sp => 
            !(sp.name === poiName && sp.lat === poiLat && sp.lon === poiLon)
        );
        item.classList.remove('selected');
        // 지도에서 마커 제거
        removePOISelectMarker(markerKey);
    } else {
        // 선택
        selectedPOIs.push(poi);
        item.classList.add('selected');
        // 지도에 마커 추가
        addPOISelectMarker(poi);
    }
    
    // 선택된 POI 개수 업데이트
    updatePOISelectedCount();
    // 거리 정보 업데이트
    updatePOIDistanceInfo();
}

// POI 선택 화면에 마커 추가
function addPOISelectMarker(poi) {
    if (!poiSelectMap) return;
    
    const markerKey = `${poi.name},${poi.lat},${poi.lon}`;
    
    // 이미 마커가 있으면 리턴
    if (poiSelectMarkers.has(markerKey)) return;
    
    const categoryColor = POI_CATEGORY_COLORS[poi.category] || '#808080';
    
    // POI 이미지 경로 (사용자가 추가할 이미지)
    const poiImagePath = `images/poi/${poi.name}.jpg`; // 또는 .png
    
    // 역물방울 모양 마커 아이콘 생성 (SVG 사용, 내부에 원형 이미지 포함)
    const teardropIcon = L.divIcon({
        className: 'poi-teardrop-marker',
        html: `
            <div style="position: relative; width: 30px; height: 40px;">
                <svg width="30" height="40" viewBox="0 0 30 40" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); position: absolute; top: 0; left: 0;">
                    <path d="M15 0 C6.716 0 0 6.716 0 15 C0 20 5 25 10 30 L15 40 L20 30 C25 25 30 20 30 15 C30 6.716 23.284 0 15 0 Z" 
                          fill="${categoryColor}" 
                          stroke="#fff" 
                          stroke-width="2"/>
                </svg>
                <div class="poi-marker-image" style="position: absolute; top: 2px; left: 50%; transform: translateX(-50%); width: 20px; height: 20px; border-radius: 50%; overflow: hidden; border: 2px solid white; background: white;">
                    <img src="${poiImagePath}" alt="${poi.name}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none';">
                </div>
            </div>
        `,
        iconSize: [30, 40],
        iconAnchor: [15, 40], // 하단 중앙을 앵커로 설정
        popupAnchor: [0, -40]
    });
    
    // 마커 생성
    const marker = L.marker([poi.lat, poi.lon], {
        icon: teardropIcon
    }).addTo(poiSelectMap);
    
    // 마커에 팝업 추가
    marker.bindPopup(`<b>${poi.name}</b><br>카테고리: ${poi.category}`);
    
    // 마커 클릭 시 선택 취소 (선택 순서와 관계없이)
    marker.on('click', () => {
        togglePOISelectMarker(markerKey);
    });
    
    // 마커 저장
    poiSelectMarkers.set(markerKey, { marker, poi });
    
    // 지도 범위 조정 (선택된 모든 POI가 보이도록)
    adjustPOISelectMapBounds();
}

// POI 선택 화면에서 마커 제거
function removePOISelectMarker(markerKey) {
    if (!poiSelectMap) return;
    
    const markerData = poiSelectMarkers.get(markerKey);
    if (markerData) {
        poiSelectMap.removeLayer(markerData.marker);
        poiSelectMarkers.delete(markerKey);
    }
    
    // 지도 범위 조정
    adjustPOISelectMapBounds();
}

// 마커 클릭 시 POI 선택 취소 (선택 순서와 관계없이)
function togglePOISelectMarker(markerKey) {
    const markerData = poiSelectMarkers.get(markerKey);
    if (!markerData) return;
    
    const poi = markerData.poi;
    
    // selectedPOIs에서 해당 POI 찾기 (선택 순서와 관계없이)
    const poiIndex = selectedPOIs.findIndex(sp => 
        sp.name === poi.name && sp.lat === poi.lat && sp.lon === poi.lon
    );
    
    if (poiIndex !== -1) {
        // 선택 해제
        selectedPOIs.splice(poiIndex, 1);
        
        // 해당 POI 아이템 찾아서 선택 해제
        const poiItems = document.querySelectorAll('.poi-select-item');
        poiItems.forEach(item => {
            const itemName = item.getAttribute('data-poi-name');
            const itemLat = parseFloat(item.getAttribute('data-poi-lat'));
            const itemLon = parseFloat(item.getAttribute('data-poi-lon'));
            
            if (itemName === poi.name && itemLat === poi.lat && itemLon === poi.lon) {
                item.classList.remove('selected');
            }
        });
        
        // 지도에서 마커 제거
        removePOISelectMarker(markerKey);
        
        // 선택된 POI 개수 업데이트
        updatePOISelectedCount();
        // 거리 정보 업데이트
        updatePOIDistanceInfo();
    }
}

// POI 선택 화면 지도 범위 조정
function adjustPOISelectMapBounds() {
    if (!poiSelectMap || poiSelectMarkers.size === 0) return;
    
    const bounds = [];
    poiSelectMarkers.forEach(({ poi }) => {
        bounds.push([poi.lat, poi.lon]);
    });
    
    if (bounds.length > 0) {
        poiSelectMap.fitBounds(bounds, {
            padding: [50, 50],
            maxZoom: 15
        });
    }
}

// 선택된 POI 개수 업데이트
function updatePOISelectedCount() {
    const countText = document.getElementById('poi-selected-count-text');
    if (countText) {
        countText.textContent = `${selectedPOIs.length}개 선택됨`;
    }
}

// 지역 선택 화면에서 시작 화면으로 돌아가기
function goBackToStartScreen() {
    const regionSelectScreen = document.getElementById('region-select-screen');
    const startScreen = document.getElementById('start-screen');
    
    if (regionSelectScreen && startScreen) {
        regionSelectScreen.classList.add('hidden');
        
        // 지역 선택 화면이 완전히 사라진 후 시작 화면 표시
        setTimeout(() => {
            startScreen.classList.remove('hidden');
        }, 500);
    }
}

// 페이지 로드 시 초기화
window.addEventListener('load', async () => {
    console.log('드로잉 런 앱이 로드되었습니다.');
    
    // 시작 화면 버튼 이벤트
    const startBtn = document.getElementById('start-btn');
    const startScreen = document.getElementById('start-screen');
    
    console.log('시작 버튼 찾기:', startBtn);
    console.log('시작 화면 찾기:', startScreen);
    
    if (startBtn && startScreen) {
        startBtn.addEventListener('click', () => {
            console.log('시작 버튼 클릭됨');
            hideStartScreen();
        });
        console.log('시작 버튼 이벤트 리스너 등록 완료');
    } else {
        console.error('시작 버튼 또는 시작 화면을 찾을 수 없습니다.');
    }
    
    // 지역 선택 화면 버튼 이벤트
    const regionBackBtn = document.getElementById('region-back-btn');
    const regionNextBtn = document.getElementById('region-next-btn');
    
    if (regionBackBtn) {
        regionBackBtn.addEventListener('click', () => {
            goBackToStartScreen();
        });
    }
    
    if (regionNextBtn) {
        regionNextBtn.addEventListener('click', () => {
            hideRegionSelectScreen();
        });
    }
    
    // 지역 선택 화면 네비게이션 다음 버튼
    const regionNextNavBtn = document.getElementById('region-next-nav-btn');
    if (regionNextNavBtn) {
        regionNextNavBtn.addEventListener('click', () => {
            hideRegionSelectScreen();
        });
    }
    
    // 지역 선택 아이템 클릭 이벤트 (현재는 하나만 있지만 확장 가능)
    const regionItems = document.querySelectorAll('.region-select-item');
    regionItems.forEach(item => {
        item.addEventListener('click', () => {
            // 모든 항목의 선택 상태 제거
            regionItems.forEach(i => i.classList.remove('selected'));
            // 클릭한 항목 선택
            item.classList.add('selected');
        });
    });
    
    // 테마 선택 화면 버튼 이벤트
    const themeBackBtn = document.getElementById('theme-back-btn');
    const themeNextBtn = document.getElementById('theme-next-btn');
    
    if (themeBackBtn) {
        themeBackBtn.addEventListener('click', () => {
            goBackToRegionSelectScreen();
        });
    }
    
    if (themeNextBtn) {
        themeNextBtn.addEventListener('click', () => {
            hideThemeSelectScreen();
        });
    }
    
    // 테마 선택 화면 네비게이션 다음 버튼
    const themeNextNavBtn = document.getElementById('theme-next-nav-btn');
    if (themeNextNavBtn) {
        themeNextNavBtn.addEventListener('click', () => {
            hideThemeSelectScreen();
        });
    }
    
    // 테마 선택 아이템 클릭 이벤트
    const themeItems = document.querySelectorAll('.theme-select-item');
    themeItems.forEach(item => {
        item.addEventListener('click', () => {
            // 모든 항목의 선택 상태 제거
            themeItems.forEach(i => i.classList.remove('selected'));
            // 클릭한 항목 선택
            item.classList.add('selected');
            // 선택된 테마 저장
            selectedTheme = item.getAttribute('data-theme');
        });
    });
    
    // POI 선택 화면 버튼 이벤트
    const poiBackBtn = document.getElementById('poi-back-btn');
    const poiNextBtn = document.getElementById('poi-next-btn');
    
    if (poiBackBtn) {
        poiBackBtn.addEventListener('click', () => {
            goBackToThemeSelectScreen();
        });
    }
    
    if (poiNextBtn) {
        poiNextBtn.addEventListener('click', async () => {
            console.log('POI 다음 버튼 클릭됨');
            try {
                await hidePOISelectScreen();
            } catch (error) {
                console.error('POI 선택 화면 전환 오류:', error);
                alert('화면 전환 중 오류가 발생했습니다. 페이지를 새로고침해주세요.');
            }
        });
    }
    
    // POI 선택 화면 네비게이션 다음 버튼
    const poiNextNavBtn = document.getElementById('poi-next-nav-btn');
    if (poiNextNavBtn) {
        poiNextNavBtn.addEventListener('click', async () => {
            console.log('POI 네비게이션 다음 버튼 클릭됨');
            try {
                await hidePOISelectScreen();
            } catch (error) {
                console.error('POI 선택 화면 전환 오류:', error);
                alert('화면 전환 중 오류가 발생했습니다. 페이지를 새로고침해주세요.');
            }
        });
    }
    
    // POI 카테고리 버튼 클릭 이벤트
    document.querySelectorAll('.poi-category-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // 모든 버튼의 active 클래스 제거
            document.querySelectorAll('.poi-category-btn').forEach(b => 
                b.classList.remove('active')
            );
            // 클릭한 버튼에 active 클래스 추가
            btn.classList.add('active');
            
            // 선택된 카테고리로 POI 목록 필터링
            const categoryKey = btn.getAttribute('data-category');
            currentPOICategory = categoryKey;
            renderPOISelectList(categoryKey);
        });
    });
    
    // 시작 위치 선택 화면 버튼 이벤트
    const startLocationBackBtn = document.getElementById('start-location-back-btn');
    const startLocationNextBtn = document.getElementById('start-location-next-btn');
    const startLocationNextNavBtn = document.getElementById('start-location-next-nav-btn');
    
    if (startLocationBackBtn) {
        startLocationBackBtn.addEventListener('click', () => {
            goBackToPOISelectScreen();
        });
    }
    
    if (startLocationNextBtn) {
        startLocationNextBtn.addEventListener('click', () => {
            showStartLocationConfirmation();
        });
    }
    
    if (startLocationNextNavBtn) {
        startLocationNextNavBtn.addEventListener('click', () => {
            showStartLocationConfirmation();
        });
    }
    
    // 메인 화면 뒤로가기 버튼
    const mainBackBtn = document.getElementById('main-back-btn');
    if (mainBackBtn) {
        mainBackBtn.addEventListener('click', () => {
            goBackToStartLocationScreen();
        });
    }
    
    // 결과 화면 뒤로가기 버튼
    const resultBackBtn = document.getElementById('result-back-btn');
    if (resultBackBtn) {
        resultBackBtn.addEventListener('click', () => {
            hideResultScreen();
        });
    }
    
    // 재탐색 버튼 이벤트 (동적으로 추가되므로 이벤트 위임 사용)
    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'retry-longer-range-btn') {
            retryWithLongerRange();
        }
    });
    
    // 드로잉런 실행 화면 버튼 이벤트
    const runningBackBtn = document.getElementById('running-back-btn');
    if (runningBackBtn) {
        runningBackBtn.addEventListener('click', () => {
            hideRunningScreen();
        });
    }
    
    const startRunningBtn = document.getElementById('start-running-btn');
    if (startRunningBtn) {
        startRunningBtn.addEventListener('click', () => {
            startRunning();
        });
    }
    
    const startAnimationBtn = document.getElementById('start-animation-btn');
    if (startAnimationBtn) {
        startAnimationBtn.addEventListener('click', () => {
            startAnimationMode();
        });
    }
    
    const stopRunningBtn = document.getElementById('stop-running-btn');
    if (stopRunningBtn) {
        stopRunningBtn.addEventListener('click', () => {
            stopRunning();
        });
    }
    
    // POI 데이터 로드
    await loadPOIData();
    
    // POI 목록 표시 (poi-list 요소가 있을 때만)
    const poiListElement = document.getElementById('poi-list');
    if (poiCatalog && poiCatalog.length > 0 && poiListElement) {
        renderPOIList();
        updateCategoryFilter();
    }
});


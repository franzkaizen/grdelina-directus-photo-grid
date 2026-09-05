<template>
	<div class="photo-grid" :class="{ disabled }">
		<v-notice v-if="!savable" type="warning">Save this item first, then add photos.</v-notice>

		<template v-else>
			<div class="toolbar">
				<div class="toolbar-actions">
					<v-button small :disabled="disabled" @click="triggerUpload">
						<v-icon name="upload" small left />
						Upload File
					</v-button>
					<v-button small secondary :disabled="disabled" @click="showPicker = true">
						<v-icon name="add" small left />
						Add Existing
					</v-button>
					<input
						ref="fileInput"
						type="file"
						accept="image/*"
						multiple
						hidden
						@change="onFilesChosen"
					/>
				</div>
				<div class="size-toggle" role="group" aria-label="Card size">
					<button
						type="button"
						:class="{ active: size === 'small' }"
						@click="setSize('small')"
					>
						<v-icon name="apps" small />
					</button>
					<button
						type="button"
						:class="{ active: size === 'large' }"
						@click="setSize('large')"
					>
						<v-icon name="grid_view" small />
					</button>
				</div>
			</div>

			<v-notice v-if="limitReached" type="info">Limit reached ({{ limit }} photos max).</v-notice>

			<div v-if="loading" class="loading"><v-progress-circular indeterminate /></div>

			<div v-else-if="items.length === 0" class="empty">
				<v-icon name="image" large />
				<p>No photos yet</p>
			</div>

			<div v-else class="grid" :class="size">
				<div
					v-for="(item, index) in items"
					:key="item.id"
					class="card"
					draggable="true"
					@dragstart="onDragStart(index, $event)"
					@dragover.prevent
					@dragenter.prevent="onDragEnter(index)"
					@drop.prevent="onDrop"
					@dragend="onDragEnd"
					:class="{ dragging: dragIndex === index, over: overIndex === index }"
				>
					<span v-if="index === 0" class="badge">Hero</span>
					<button type="button" class="remove" :disabled="disabled" @click.stop="removeItem(item)">
						<v-icon name="close" small />
					</button>
					<img
						:src="thumbUrl(item.file, size === 'large' ? 480 : 200)"
						:alt="item.file?.filename_download || ''"
						loading="lazy"
						@click="openLightbox(index)"
					/>
				</div>
			</div>
		</template>

		<v-drawer :model-value="showPicker" title="Add existing photos" icon="add" @cancel="showPicker = false">
			<template #actions>
				<v-button icon rounded @click="showPicker = false"><v-icon name="close" /></v-button>
			</template>
			<div class="picker">
				<v-input v-model="pickerSearch" placeholder="Search filename…" class="picker-search">
					<template #prepend><v-icon name="search" /></template>
				</v-input>
				<div v-if="pickerLoading" class="loading"><v-progress-circular indeterminate /></div>
				<div v-else class="grid large picker-grid">
					<div
						v-for="file in pickerResults"
						:key="file.id"
						class="card picker-card"
						:class="{ added: isAlreadyAdded(file.id) }"
						@click="!isAlreadyAdded(file.id) && addExisting(file)"
					>
						<img :src="thumbUrl(file, 300)" :alt="file.filename_download || ''" loading="lazy" />
						<span v-if="isAlreadyAdded(file.id)" class="added-badge"><v-icon name="check" small /></span>
					</div>
				</div>
				<v-button v-if="pickerHasMore && !pickerLoading" secondary full-width @click="loadMorePicker">
					Load more
				</v-button>
			</div>
		</v-drawer>

		<div v-if="lightboxIndex !== null" class="lightbox" @click.self="closeLightbox">
			<button type="button" class="lb-close" @click="closeLightbox"><v-icon name="close" /></button>
			<button type="button" class="lb-prev" @click="stepLightbox(-1)"><v-icon name="chevron_left" /></button>
			<img class="lb-img" :src="fullUrl(items[lightboxIndex]?.file)" :alt="''" />
			<button type="button" class="lb-next" @click="stepLightbox(1)"><v-icon name="chevron_right" /></button>
			<div class="lb-count">{{ lightboxIndex + 1 }} / {{ items.length }}</div>
		</div>
	</div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useApi, useStores } from '@directus/extensions-sdk';

const props = defineProps({
	value: { type: Array, default: null },
	primaryKey: { type: [String, Number], default: null },
	collection: { type: String, default: null },
	field: { type: String, default: null },
	disabled: { type: Boolean, default: false },
	junctionCollection: { type: String, default: null },
	parentField: { type: String, default: null },
	limit: { type: [String, Number], default: null },
	defaultSize: { type: String, default: 'large' },
});

const emit = defineEmits(['input']);

const api = useApi();
const { useNotificationsStore } = useStores();
const notifications = useNotificationsStore();

const savable = computed(() => props.primaryKey !== null && props.primaryKey !== undefined && props.primaryKey !== '+');
const limitNum = computed(() => (props.limit ? Number(props.limit) : null));
const limitReached = computed(() => limitNum.value !== null && items.value.length >= limitNum.value);

const storageKey = `grdelina-photo-grid-size-${props.collection}-${props.field}`;
const size = ref(localStorage.getItem(storageKey) || props.defaultSize || 'large');
function setSize(next) {
	size.value = next;
	try {
		localStorage.setItem(storageKey, next);
	} catch (e) {
		// ignore (private browsing etc.)
	}
}

const items = ref([]);
const loading = ref(false);

const FILE_FIELDS = 'id,filename_download,type,width,height,modified_on';

async function fetchItems() {
	if (!savable.value) return;
	loading.value = true;
	try {
		const res = await api.get(`/items/${props.junctionCollection}`, {
			params: {
				filter: { [props.parentField]: { _eq: props.primaryKey } },
				fields: ['id', 'sort', `directus_files_id.${FILE_FIELDS.replace(/,/g, ',directus_files_id.')}`].join(','),
				sort: 'sort',
				limit: -1,
			},
		});
		items.value = (res.data.data || []).map((row) => ({
			id: row.id,
			sort: row.sort,
			file: row.directus_files_id,
		}));
		emitValue();
	} catch (err) {
		notifications.add({ title: 'Could not load photos', type: 'error' });
	} finally {
		loading.value = false;
	}
}

function emitValue() {
	emit('input', items.value.map((i) => i.file?.id).filter(Boolean));
}

onMounted(fetchItems);
watch(() => props.primaryKey, fetchItems);

function thumbUrl(file, width) {
	if (!file?.id) return '';
	const base = api.defaults.baseURL.replace(/\/+$/, '');
	return `${base}/assets/${file.id}?width=${width}&fit=cover&quality=80`;
}
function fullUrl(file) {
	if (!file?.id) return '';
	const base = api.defaults.baseURL.replace(/\/+$/, '');
	return `${base}/assets/${file.id}?width=1600`;
}

const fileInput = ref(null);
function triggerUpload() {
	fileInput.value?.click();
}
async function onFilesChosen(e) {
	const files = Array.from(e.target.files || []);
	e.target.value = '';
	for (const file of files) {
		if (limitReached.value) break;
		await uploadAndLink(file);
	}
}
async function uploadAndLink(file) {
	try {
		const formData = new FormData();
		formData.append('file', file);
		const uploadRes = await api.post('/files', formData);
		const newFileId = uploadRes.data.data.id;
		await linkExisting(newFileId);
	} catch (err) {
		notifications.add({ title: `Could not upload ${file.name}`, type: 'error' });
	}
}

async function linkExisting(fileId) {
	const nextSort = items.value.length ? Math.max(...items.value.map((i) => i.sort || 0)) + 10 : 10;
	await api.post(`/items/${props.junctionCollection}`, {
		[props.parentField]: props.primaryKey,
		directus_files_id: fileId,
		sort: nextSort,
	});
	await fetchItems();
}

async function removeItem(item) {
	if (props.disabled) return;
	try {
		await api.delete(`/items/${props.junctionCollection}/${item.id}`);
		items.value = items.value.filter((i) => i.id !== item.id);
		emitValue();
	} catch (err) {
		notifications.add({ title: 'Could not remove photo', type: 'error' });
	}
}

const dragIndex = ref(null);
const overIndex = ref(null);
function onDragStart(index) {
	dragIndex.value = index;
}
function onDragEnter(index) {
	overIndex.value = index;
}
function onDragEnd() {
	dragIndex.value = null;
	overIndex.value = null;
}
async function onDrop() {
	if (dragIndex.value === null || overIndex.value === null || dragIndex.value === overIndex.value) {
		onDragEnd();
		return;
	}
	const reordered = [...items.value];
	const [moved] = reordered.splice(dragIndex.value, 1);
	reordered.splice(overIndex.value, 0, moved);
	items.value = reordered;
	onDragEnd();

	const updates = reordered.map((item, i) => ({ id: item.id, sort: (i + 1) * 10 }));
	items.value.forEach((item, i) => (item.sort = updates[i].sort));
	try {
		await api.patch(`/items/${props.junctionCollection}`, updates);
	} catch (err) {
		notifications.add({ title: 'Could not save new order', type: 'error' });
		fetchItems();
	}
}

const showPicker = ref(false);
const pickerSearch = ref('');
const pickerResults = ref([]);
const pickerLoading = ref(false);
const pickerPage = ref(1);
const pickerHasMore = ref(true);

async function runPickerSearch() {
	pickerPage.value = 1;
	pickerResults.value = [];
	pickerHasMore.value = true;
	await loadMorePicker();
}
watch(showPicker, (open) => {
	if (open) runPickerSearch();
});
let searchDebounce;
watch(pickerSearch, () => {
	clearTimeout(searchDebounce);
	searchDebounce = setTimeout(runPickerSearch, 350);
});

async function loadMorePicker() {
	pickerLoading.value = true;
	try {
		const res = await api.get('/files', {
			params: {
				filter: {
					type: { _starts_with: 'image/' },
					...(pickerSearch.value ? { filename_download: { _icontains: pickerSearch.value } } : {}),
				},
				fields: FILE_FIELDS,
				sort: '-uploaded_on',
				limit: 60,
				page: pickerPage.value,
			},
		});
		const rows = res.data.data || [];
		pickerResults.value = [...pickerResults.value, ...rows];
		pickerHasMore.value = rows.length === 60;
		pickerPage.value += 1;
	} catch (err) {
		notifications.add({ title: 'Could not load files', type: 'error' });
	} finally {
		pickerLoading.value = false;
	}
}
function isAlreadyAdded(fileId) {
	return items.value.some((i) => i.file?.id === fileId);
}
async function addExisting(file) {
	if (limitReached.value) return;
	await linkExisting(file.id);
}

const lightboxIndex = ref(null);
function openLightbox(index) {
	lightboxIndex.value = index;
}
function closeLightbox() {
	lightboxIndex.value = null;
}
function stepLightbox(delta) {
	if (lightboxIndex.value === null) return;
	const len = items.value.length;
	lightboxIndex.value = (lightboxIndex.value + delta + len) % len;
}
</script>

<style scoped>
.photo-grid {
	display: flex;
	flex-direction: column;
	gap: 12px;
}
.toolbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}
.toolbar-actions {
	display: flex;
	gap: 8px;
}
.size-toggle {
	display: flex;
	border: var(--theme--border-width) solid var(--theme--form--field--input--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
}
.size-toggle button {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 32px;
	background: var(--theme--form--field--input--background);
	color: var(--theme--foreground-subdued);
	cursor: pointer;
}
.size-toggle button.active {
	background: var(--theme--primary);
	color: var(--white);
}
.loading,
.empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 8px;
	padding: 40px;
	color: var(--theme--foreground-subdued);
	background: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
}
.grid {
	display: grid;
	gap: 8px;
}
.grid.large {
	grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
}
.grid.small {
	grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
}
.card {
	position: relative;
	aspect-ratio: 4 / 3;
	border-radius: var(--theme--border-radius);
	overflow: hidden;
	background: var(--theme--background-subdued);
	cursor: grab;
}
.card.dragging {
	opacity: 0.4;
}
.card.over {
	outline: 2px solid var(--theme--primary);
}
.card img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
	cursor: pointer;
}
.card .badge {
	position: absolute;
	top: 6px;
	left: 6px;
	z-index: 2;
	background: var(--theme--primary);
	color: var(--white);
	font-size: 11px;
	line-height: 1;
	padding: 4px 8px;
	border-radius: 999px;
}
.card .remove {
	position: absolute;
	top: 6px;
	right: 6px;
	z-index: 2;
	width: 22px;
	height: 22px;
	border-radius: 50%;
	background: rgb(0 0 0 / 0.55);
	color: #fff;
	display: flex;
	align-items: center;
	justify-content: center;
	opacity: 0;
	transition: opacity var(--fast, 150ms);
}
.card:hover .remove {
	opacity: 1;
}
.picker {
	padding: 20px;
	display: flex;
	flex-direction: column;
	gap: 16px;
}
.picker-search {
	max-width: 320px;
}
.picker-card {
	cursor: pointer;
}
.picker-card.added {
	opacity: 0.4;
	cursor: default;
}
.added-badge {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgb(0 0 0 / 0.35);
	color: #fff;
}
.lightbox {
	position: fixed;
	inset: 0;
	z-index: 999;
	background: rgb(20 20 20 / 0.94);
	display: flex;
	align-items: center;
	justify-content: center;
}
.lb-img {
	max-width: 92vw;
	max-height: 92vh;
	object-fit: contain;
	border-radius: 6px;
}
.lb-close,
.lb-prev,
.lb-next {
	position: absolute;
	width: 44px;
	height: 44px;
	border-radius: 50%;
	background: rgb(255 255 255 / 0.12);
	color: #fff;
	display: flex;
	align-items: center;
	justify-content: center;
}
.lb-close {
	top: 20px;
	right: 20px;
}
.lb-prev {
	left: 20px;
	top: 50%;
	transform: translateY(-50%);
}
.lb-next {
	right: 20px;
	top: 50%;
	transform: translateY(-50%);
}
.lb-count {
	position: absolute;
	bottom: 20px;
	left: 50%;
	transform: translateX(-50%);
	color: #fff;
	background: rgb(255 255 255 / 0.12);
	padding: 6px 14px;
	border-radius: 999px;
	font-size: 13px;
}
</style>

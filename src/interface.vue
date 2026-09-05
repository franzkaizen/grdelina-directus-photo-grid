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

			<v-notice v-if="limitReached" type="info">Limit reached ({{ props.limit }} photos max).</v-notice>

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
						@click="openFileDetail(item.file)"
					/>
				</div>
			</div>
		</template>

		<v-drawer :model-value="showPicker" title="Add existing photos" icon="add" @cancel="showPicker = false">
			<div class="picker">
				<v-input v-model="pickerSearch" placeholder="Search filename…" class="picker-search">
					<template #prepend><v-icon name="search" /></template>
				</v-input>

				<div v-if="!pickerSearch" class="breadcrumb">
					<button type="button" @click="goToFolder(null)">Root</button>
					<template v-for="crumb in folderPath" :key="crumb.id">
						<v-icon name="chevron_right" small />
						<button type="button" @click="goToFolder(crumb.id)">{{ crumb.name }}</button>
					</template>
				</div>

				<div v-if="pickerLoading" class="loading"><v-progress-circular indeterminate /></div>
				<div v-else class="grid large picker-grid">
					<div
						v-for="folder in pickerFolders"
						:key="'folder-' + folder.id"
						class="card picker-card folder-card"
						@click="goToFolder(folder.id, folder.name)"
					>
						<v-icon name="folder" x-large />
						<span class="folder-name">{{ folder.name }}</span>
					</div>
					<div
						v-for="file in pickerResults"
						:key="file.id"
						class="card picker-card"
						:class="{ added: isAlreadyAdded(file.id) }"
						@click="toggleExisting(file)"
					>
						<img :src="thumbUrl(file, 300)" :alt="file.filename_download || ''" loading="lazy" />
						<span v-if="isAlreadyAdded(file.id)" class="added-badge">
							<v-icon name="check" small class="icon-check" />
							<v-icon name="close" small class="icon-remove" />
						</span>
					</div>
				</div>
				<v-button v-if="pickerHasMore && !pickerLoading" secondary full-width @click="loadMorePicker">
					Load more
				</v-button>
			</div>
		</v-drawer>
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
				filter: JSON.stringify({ [props.parentField]: { _eq: props.primaryKey } }),
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
	return `/assets/${file.id}?width=${width}`;
}

function openFileDetail(file) {
	if (!file?.id) return;
	window.open(`${window.location.origin}/admin/files/${file.id}`, '_blank');
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
const currentFolder = ref(null);
const folderPath = ref([]);
const pickerFolders = ref([]);

async function fetchFolders() {
	try {
		const res = await api.get('/folders', {
			params: {
				filter: JSON.stringify(
					currentFolder.value ? { parent: { _eq: currentFolder.value } } : { parent: { _null: true } },
				),
				fields: 'id,name',
				sort: 'name',
				limit: -1,
			},
		});
		pickerFolders.value = res.data.data || [];
	} catch (err) {
		pickerFolders.value = [];
	}
}

function goToFolder(id, name) {
	if (id === null) {
		folderPath.value = [];
	} else {
		const existingIndex = folderPath.value.findIndex((c) => c.id === id);
		if (existingIndex !== -1) {
			folderPath.value = folderPath.value.slice(0, existingIndex + 1);
		} else {
			folderPath.value = [...folderPath.value, { id, name }];
		}
	}
	currentFolder.value = id;
	runPickerSearch();
}

async function runPickerSearch() {
	pickerPage.value = 1;
	pickerResults.value = [];
	pickerHasMore.value = true;
	pickerFolders.value = [];
	if (!pickerSearch.value) await fetchFolders();
	await loadMorePicker();
}
watch(showPicker, (open) => {
	if (open) {
		currentFolder.value = null;
		folderPath.value = [];
		runPickerSearch();
	}
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
				filter: JSON.stringify({
					type: { _starts_with: 'image/' },
					...(pickerSearch.value
						? { filename_download: { _icontains: pickerSearch.value } }
						: { folder: currentFolder.value ? { _eq: currentFolder.value } : { _null: true } }),
				}),
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
async function toggleExisting(file) {
	const existing = items.value.find((i) => i.file?.id === file.id);
	if (existing) {
		await removeItem(existing);
	} else {
		await addExisting(file);
	}
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
.breadcrumb {
	display: flex;
	align-items: center;
	gap: 4px;
	flex-wrap: wrap;
}
.breadcrumb button {
	font-size: 14px;
	color: var(--theme--foreground-subdued);
	padding: 2px 4px;
}
.breadcrumb button:last-child {
	color: var(--theme--foreground);
	font-weight: 600;
}
.breadcrumb button:hover {
	color: var(--theme--primary);
}
.picker-card {
	cursor: pointer;
}
.folder-card {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 6px;
	background: var(--theme--background-subdued);
	color: var(--theme--foreground-subdued);
}
.folder-card:hover {
	background: var(--theme--background-normal);
	color: var(--theme--primary);
}
.folder-name {
	font-size: 13px;
	text-align: center;
	padding: 0 8px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	max-width: 100%;
}
.picker-card.added {
	opacity: 0.4;
}
.picker-card.added:hover {
	opacity: 0.7;
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
.added-badge .icon-remove {
	display: none;
}
.picker-card.added:hover .icon-check {
	display: none;
}
.picker-card.added:hover .icon-remove {
	display: block;
}
</style>

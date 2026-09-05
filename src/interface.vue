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

			<div v-else-if="displayItems.length === 0" class="empty">
				<v-icon name="image" large />
				<p>No photos yet</p>
			</div>

			<div v-else class="grid" :class="size">
				<div
					v-for="(item, index) in displayItems"
					:key="item.key"
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
	value: { type: [Object, Array], default: null },
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

const FILE_FIELDS = 'id,filename_download,type,width,height,modified_on';

// ---- Staged editing --------------------------------------------------------
// Normal Directus behaviour: nothing touches the junction until the parent
// item's own Save button is clicked, and everything here is discardable by
// navigating away instead, same as every other field. We keep local
// create/update/delete lists and hand them to Directus as its own documented
// nested-relational payload shape ({ create, update, delete }) via
// emit('input', ...) -- Directus's own save logic applies that against the
// junction when the parent item is saved. New file *uploads* are the one
// exception: the binary has to exist as a directus_files row immediately,
// same as native Directus's own Files field -- only the *link* to this
// parent is staged, not the upload itself.
const savedItems = ref([]); // committed junction rows already on the server: {id, sort, file}
const pendingCreate = ref([]); // [{ _key, file, sort }] -- not yet linked
const pendingUpdate = ref({}); // { [savedItemId]: newSort }
const pendingDelete = ref(new Set()); // Set<savedItemId>
const loading = ref(false);

const displayItems = computed(() => {
	const kept = savedItems.value
		.filter((i) => !pendingDelete.value.has(i.id))
		.map((i) => ({
			key: `saved-${i.id}`,
			id: i.id,
			isNew: false,
			file: i.file,
			sort: pendingUpdate.value[i.id] ?? i.sort,
		}));
	const created = pendingCreate.value.map((c) => ({
		key: c._key,
		id: null,
		isNew: true,
		_key: c._key,
		file: c.file,
		sort: c.sort,
	}));
	return [...kept, ...created].sort((a, b) => a.sort - b.sort);
});

const limitNum = computed(() => (props.limit ? Number(props.limit) : null));
const limitReached = computed(() => limitNum.value !== null && displayItems.value.length >= limitNum.value);

function nextSort() {
	const sorts = displayItems.value.map((i) => i.sort || 0);
	return sorts.length ? Math.max(...sorts) + 10 : 10;
}

function emitPending() {
	const create = pendingCreate.value.map((c) => ({ directus_files_id: c.file.id, sort: c.sort }));
	const update = Object.entries(pendingUpdate.value).map(([id, sort]) => ({ id: Number(id), sort }));
	const del = [...pendingDelete.value];
	if (create.length === 0 && update.length === 0 && del.length === 0) {
		emit('input', null);
	} else {
		emit('input', { create, update, delete: del });
	}
}

function resetPending() {
	pendingCreate.value = [];
	pendingUpdate.value = {};
	pendingDelete.value = new Set();
}

async function fetchSavedItems() {
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
		savedItems.value = (res.data.data || []).map((row) => ({
			id: row.id,
			sort: row.sort,
			file: row.directus_files_id,
		}));
	} catch (err) {
		notifications.add({ title: 'Could not load photos', type: 'error' });
	} finally {
		loading.value = false;
	}
}

// Recover in-progress edits if this component ever remounts before Save (e.g.
// switching tabs within the same item form) -- Directus hands back exactly
// what we last emitted as `value`.
async function restorePendingFromValue() {
	const v = props.value;
	if (!v || typeof v !== 'object' || Array.isArray(v)) return;
	pendingUpdate.value = {};
	(v.update || []).forEach((u) => {
		pendingUpdate.value[u.id] = u.sort;
	});
	pendingDelete.value = new Set(v.delete || []);
	const creates = v.create || [];
	if (creates.length === 0) {
		pendingCreate.value = [];
		return;
	}
	try {
		const ids = creates.map((c) => c.directus_files_id);
		const res = await api.get('/files', {
			params: { filter: JSON.stringify({ id: { _in: ids } }), fields: FILE_FIELDS, limit: -1 },
		});
		const byId = Object.fromEntries((res.data.data || []).map((f) => [f.id, f]));
		pendingCreate.value = creates.map((c) => ({
			_key: `new-${c.directus_files_id}`,
			file: byId[c.directus_files_id] || { id: c.directus_files_id },
			sort: c.sort,
		}));
	} catch (err) {
		pendingCreate.value = [];
	}
}

onMounted(async () => {
	await fetchSavedItems();
	await restorePendingFromValue();
});
watch(
	() => props.primaryKey,
	async () => {
		resetPending();
		await fetchSavedItems();
	},
);

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
		await uploadAndStage(file);
	}
}
async function uploadAndStage(file) {
	try {
		const formData = new FormData();
		formData.append('file', file);
		const uploadRes = await api.post('/files', formData, { params: { fields: FILE_FIELDS } });
		stageCreate(uploadRes.data.data);
	} catch (err) {
		notifications.add({ title: `Could not upload ${file.name}`, type: 'error' });
	}
}

function stageCreate(file) {
	if (limitReached.value) return;
	pendingCreate.value = [...pendingCreate.value, { _key: `new-${file.id}-${Date.now()}`, file, sort: nextSort() }];
	emitPending();
}

function removeItem(item) {
	if (props.disabled) return;
	if (item.isNew) {
		pendingCreate.value = pendingCreate.value.filter((c) => c._key !== item._key);
	} else {
		pendingDelete.value = new Set([...pendingDelete.value, item.id]);
	}
	emitPending();
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
function onDrop() {
	if (dragIndex.value === null || overIndex.value === null || dragIndex.value === overIndex.value) {
		onDragEnd();
		return;
	}
	const reordered = [...displayItems.value];
	const [moved] = reordered.splice(dragIndex.value, 1);
	reordered.splice(overIndex.value, 0, moved);
	onDragEnd();

	reordered.forEach((item, i) => {
		const newSort = (i + 1) * 10;
		if (item.isNew) {
			const c = pendingCreate.value.find((c) => c._key === item._key);
			if (c) c.sort = newSort;
		} else {
			pendingUpdate.value = { ...pendingUpdate.value, [item.id]: newSort };
		}
	});
	emitPending();
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
function findDisplayItemByFileId(fileId) {
	return displayItems.value.find((i) => i.file?.id === fileId);
}
function isAlreadyAdded(fileId) {
	return !!findDisplayItemByFileId(fileId);
}
function toggleExisting(file) {
	const existing = findDisplayItemByFileId(file.id);
	if (existing) {
		removeItem(existing);
	} else {
		stageCreate(file);
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

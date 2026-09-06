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
				<div v-if="!cols" class="size-toggle" role="group" aria-label="Card size">
					<button type="button" :class="{ active: size === 'small' }" @click="setSize('small')">
						<v-icon name="apps" small />
					</button>
					<button type="button" :class="{ active: size === 'large' }" @click="setSize('large')">
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

			<div
				v-else
				class="grid"
				:class="cols ? ['preview', `preview-${cols}`] : size"
				:style="cols ? { gridTemplateColumns: `repeat(${cols}, 1fr)` } : null"
			>
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
					:class="{ dragging: dragIndex === index, over: overIndex === index, featured: item.featured }"
				>
					<button
						v-if="featureEnabled"
						type="button"
						class="badge badge--toggle"
						:class="{ 'is-off': !isHero(item, index) }"
						:disabled="disabled"
						:title="item.featured ? 'Featured — click to unset' : 'Make this a featured photo'"
						@click.stop="toggleFeatured(item)"
					>
						<v-icon name="star" x-small />
						Featured
					</button>
					<span v-else-if="index === 0" class="badge">Featured</span>

					<button type="button" class="remove" :disabled="disabled" @click.stop="removeItem(item)">
						<v-icon name="close" small />
					</button>
					<img
						:src="thumbUrl(item.file, size === 'large' ? 480 : 200)"
						:alt="item.file?.filename_download || ''"
						loading="lazy"
						@click="openFileDrawer(item.file)"
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

		<v-drawer
			:model-value="showFileDrawer"
			:title="drawerFile?.filename_download || 'Photo'"
			icon="image"
			@cancel="showFileDrawer = false"
		>
			<template #actions>
				<v-button v-tooltip.bottom="'Open full file editor'" icon rounded secondary :href="fileAdminUrl">
					<v-icon name="open_in_new" />
				</v-button>
				<v-button v-tooltip.bottom="'Save'" icon rounded :loading="drawerSaving" @click="saveDrawer">
					<v-icon name="check" />
				</v-button>
			</template>
			<div v-if="drawerFile" class="file-drawer">
				<img :src="thumbUrl(drawerFile, 1400)" :alt="drawerForm.title || drawerFile.filename_download || ''" />
				<div class="field">
					<p class="field-label">Title</p>
					<v-input v-model="drawerForm.title" placeholder="Title" />
				</div>
				<div class="field">
					<p class="field-label">Description <span class="hint">(used as alt text)</span></p>
					<v-textarea v-model="drawerForm.description" :rows="3" placeholder="Describe what's in the photo" />
				</div>
				<div class="field">
					<p class="field-label">Tags <span class="hint">(comma-separated)</span></p>
					<v-input v-model="drawerForm.tags" placeholder="e.g. exterior, sea view" />
				</div>
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
	featuredField: { type: String, default: null },
	previewColumns: { type: [String, Number], default: null },
});

const emit = defineEmits(['input']);

const api = useApi();
const { useNotificationsStore } = useStores();
const notifications = useNotificationsStore();

const savable = computed(() => props.primaryKey !== null && props.primaryKey !== undefined && props.primaryKey !== '+');
const featureEnabled = computed(() => !!props.featuredField);

// When set, the grid is locked to this many columns to mirror the final site
// layout (2 = apartment sections, 3 = villa gallery) and the Small/Large toggle
// is hidden. Featured cards span the full width at 2 columns, 2×2 above that.
const cols = computed(() => {
	const n = Number(props.previewColumns);
	return Number.isInteger(n) && n >= 2 && n <= 6 ? n : null;
});

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
// Nothing touches the junction until the parent item's own Save is clicked;
// everything here is discardable by navigating away, same as every other field.
// We keep local create/update/delete state and hand Directus its own documented
// nested-relational payload shape ({ create, update, delete }) via
// emit('input', ...). New file *uploads* are the one exception: the binary has
// to exist as a directus_files row immediately -- only the *link* is staged.
const savedItems = ref([]); // committed junction rows: {id, sort, featured, file}
const pendingCreate = ref([]); // [{ _key, file, sort, featured }]
const pendingUpdate = ref({}); // { [savedItemId]: newSort }
const pendingFeatured = ref({}); // { [savedItemId]: boolean }
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
			featured: pendingFeatured.value[i.id] ?? i.featured ?? false,
		}));
	const created = pendingCreate.value.map((c) => ({
		key: c._key,
		id: null,
		isNew: true,
		_key: c._key,
		file: c.file,
		sort: c.sort,
		featured: !!c.featured,
	}));
	return [...kept, ...created].sort((a, b) => a.sort - b.sort);
});

const anyFeatured = computed(() => displayItems.value.some((i) => i.featured));

// The card that visually reads as the hero: an explicitly-featured one, or --
// mirroring the site's fallback -- the first photo when nothing is featured.
function isHero(item, index) {
	if (item.featured) return true;
	return !anyFeatured.value && index === 0;
}

const limitNum = computed(() => (props.limit ? Number(props.limit) : null));
const limitReached = computed(() => limitNum.value !== null && displayItems.value.length >= limitNum.value);

function nextSort() {
	const sorts = displayItems.value.map((i) => i.sort || 0);
	return sorts.length ? Math.max(...sorts) + 10 : 10;
}

function emitPending() {
	const ff = props.featuredField;
	const create = pendingCreate.value.map((c) => {
		const row = { directus_files_id: c.file.id, sort: c.sort };
		if (ff) row[ff] = !!c.featured;
		return row;
	});

	// Merge sort + featured changes per saved row id.
	const changed = {};
	for (const [id, sort] of Object.entries(pendingUpdate.value)) {
		(changed[id] ||= { id: Number(id) }).sort = sort;
	}
	if (ff) {
		for (const [id, featured] of Object.entries(pendingFeatured.value)) {
			(changed[id] ||= { id: Number(id) })[ff] = !!featured;
		}
	}
	const update = Object.values(changed);
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
	pendingFeatured.value = {};
	pendingDelete.value = new Set();
}

async function fetchSavedItems() {
	if (!savable.value) return;
	loading.value = true;
	try {
		const fields = ['id', 'sort', `directus_files_id.${FILE_FIELDS.replace(/,/g, ',directus_files_id.')}`];
		if (props.featuredField) fields.push(props.featuredField);
		const res = await api.get(`/items/${props.junctionCollection}`, {
			params: {
				filter: JSON.stringify({ [props.parentField]: { _eq: props.primaryKey } }),
				fields: fields.join(','),
				sort: 'sort',
				limit: -1,
			},
		});
		savedItems.value = (res.data.data || []).map((row) => ({
			id: row.id,
			sort: row.sort,
			featured: props.featuredField ? !!row[props.featuredField] : false,
			file: row.directus_files_id,
		}));
	} catch (err) {
		notifications.add({ title: 'Could not load photos', type: 'error' });
	} finally {
		loading.value = false;
	}
}

// Recover in-progress edits if this component remounts before Save (tab switch
// within the same item form) -- Directus hands back what we last emitted.
async function restorePendingFromValue() {
	const v = props.value;
	if (!v || typeof v !== 'object' || Array.isArray(v)) return;
	const ff = props.featuredField;
	pendingUpdate.value = {};
	pendingFeatured.value = {};
	(v.update || []).forEach((u) => {
		if (typeof u.sort === 'number') pendingUpdate.value[u.id] = u.sort;
		if (ff && u[ff] !== undefined) pendingFeatured.value[u.id] = !!u[ff];
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
			featured: ff ? !!c[ff] : false,
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

// ---- file drawer (edit metadata in place, no tab switch) ------------------
const showFileDrawer = ref(false);
const drawerFile = ref(null);
const drawerSaving = ref(false);
const drawerForm = ref({ title: '', description: '', tags: '' });
const fileAdminUrl = computed(() =>
	drawerFile.value?.id ? `${window.location.origin}/admin/files/${drawerFile.value.id}` : '',
);

async function openFileDrawer(file) {
	if (!file?.id) return;
	drawerFile.value = file;
	drawerForm.value = { title: '', description: '', tags: '' };
	showFileDrawer.value = true;
	try {
		const res = await api.get(`/files/${file.id}`, { params: { fields: 'title,description,tags' } });
		const d = res.data.data || {};
		drawerForm.value = {
			title: d.title || '',
			description: d.description || '',
			tags: Array.isArray(d.tags) ? d.tags.join(', ') : d.tags || '',
		};
	} catch (err) {
		notifications.add({ title: 'Could not load file details', type: 'error' });
	}
}

async function saveDrawer() {
	if (!drawerFile.value?.id) return;
	drawerSaving.value = true;
	try {
		await api.patch(`/files/${drawerFile.value.id}`, {
			title: drawerForm.value.title || null,
			description: drawerForm.value.description || null,
			tags: drawerForm.value.tags
				? drawerForm.value.tags.split(',').map((t) => t.trim()).filter(Boolean)
				: null,
		});
		notifications.add({ title: 'Photo details saved' });
		showFileDrawer.value = false;
	} catch (err) {
		notifications.add({ title: 'Could not save', type: 'error' });
	} finally {
		drawerSaving.value = false;
	}
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
	pendingCreate.value = [
		...pendingCreate.value,
		{ _key: `new-${file.id}-${Date.now()}`, file, sort: nextSort(), featured: false },
	];
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

function toggleFeatured(item) {
	if (props.disabled || !props.featuredField) return;
	if (item.isNew) {
		const c = pendingCreate.value.find((x) => x._key === item._key);
		if (c) c.featured = !c.featured;
		pendingCreate.value = [...pendingCreate.value];
	} else {
		const current = pendingFeatured.value[item.id] ?? item.featured ?? false;
		pendingFeatured.value = { ...pendingFeatured.value, [item.id]: !current };
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
	grid-auto-flow: dense;
}
.grid.large {
	grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
}
.grid.small {
	grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
}
/* previewColumns: grid-template-columns is set inline; featured spans the full
   width at 2 cols (apartment sections = one big band), 2×2 at 3+ (villa grid). */
.grid.preview-2 .card.featured {
	grid-row: auto;
}
.card {
	position: relative;
	aspect-ratio: 4 / 3;
	border-radius: var(--theme--border-radius);
	overflow: hidden;
	background: var(--theme--background-subdued);
	cursor: grab;
}
.card.featured {
	grid-column: span 2;
	grid-row: span 2;
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
	display: inline-flex;
	align-items: center;
	gap: 3px;
	background: var(--theme--primary);
	color: var(--white);
	font-size: 11px;
	line-height: 1;
	padding: 4px 8px;
	border-radius: 999px;
}
.card .badge--toggle {
	cursor: pointer;
	border: none;
}
.card .badge--toggle.is-off {
	background: rgb(0 0 0 / 0.45);
	opacity: 0;
	transition: opacity var(--fast, 150ms);
}
.card:hover .badge--toggle.is-off {
	opacity: 1;
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
.file-drawer {
	padding: 20px;
	display: flex;
	flex-direction: column;
	gap: 16px;
}
.file-drawer img {
	width: 100%;
	max-height: 55vh;
	object-fit: contain;
	border-radius: var(--theme--border-radius);
	background: var(--theme--background-subdued);
}
.file-drawer .field-label {
	font-size: 13px;
	margin-bottom: 4px;
	color: var(--theme--foreground-subdued);
}
.file-drawer .hint {
	opacity: 0.7;
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

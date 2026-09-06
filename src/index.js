import InterfaceComponent from './interface.vue';

export default {
	id: 'grdelina-photo-grid',
	name: 'Photo Grid',
	icon: 'grid_view',
	description:
		'Large-thumbnail photo grid for M2M-to-files fields: Small/Large size toggle (or lock to N columns to mirror the site layout), drag reorder, an optional per-photo "featured" flag (featured photos render larger), and click a photo to edit its title/description/tags in a slide-in drawer.',
	component: InterfaceComponent,
	types: ['alias'],
	localTypes: ['files'],
	group: 'relational',
	relational: true,
	options: [
		{
			field: 'junctionCollection',
			name: 'Junction collection',
			type: 'string',
			meta: {
				interface: 'input',
				width: 'half',
				note: 'The M2M junction table, e.g. apartments_hero_tiles',
				required: true,
			},
		},
		{
			field: 'parentField',
			name: 'Parent id field',
			type: 'string',
			meta: {
				interface: 'input',
				width: 'half',
				note: 'The junction column pointing back to this collection, e.g. apartments_id',
				required: true,
			},
		},
		{
			field: 'limit',
			name: 'Max photos',
			type: 'integer',
			meta: {
				interface: 'input',
				width: 'half',
				note: 'Leave empty for unlimited (e.g. Hero tiles = 3)',
			},
		},
		{
			field: 'defaultSize',
			name: 'Default card size',
			type: 'string',
			schema: { default_value: 'large' },
			meta: {
				interface: 'select-dropdown',
				width: 'half',
				options: {
					choices: [
						{ text: 'Small', value: 'small' },
						{ text: 'Large', value: 'large' },
					],
				},
			},
		},
		{
			field: 'featuredField',
			name: 'Featured flag column',
			type: 'string',
			meta: {
				interface: 'input',
				width: 'half',
				note: 'Optional. A boolean column on the junction that marks a photo as featured (e.g. `featured`, `full_width`). Set it to show a per-photo Featured toggle and render featured photos larger. Leave empty to disable.',
			},
		},
		{
			field: 'previewColumns',
			name: 'Preview columns',
			type: 'integer',
			meta: {
				interface: 'input',
				width: 'half',
				note: 'Optional. Lock the grid to this many columns to mirror the final site layout (2 = apartment sections, 3 = villa gallery). Hides the Small/Large toggle. Featured photos fill the full width at 2 columns, 2×2 at 3+.',
			},
		},
	],
};

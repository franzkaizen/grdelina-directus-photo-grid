import InterfaceComponent from './interface.vue';

export default {
	id: 'grdelina-photo-grid',
	name: 'Photo Grid',
	icon: 'grid_view',
	description:
		'Large-thumbnail photo grid for M2M-to-files fields: Small/Large size toggle, drag reorder, an optional per-photo "featured" flag (featured photos show 2×2), and click a photo to edit its title/description/tags in a slide-in drawer.',
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
				note: 'Optional. A boolean column on the junction that marks a photo as the big / hero one (e.g. `featured`, `full_width`). Set it to show a per-photo toggle and render featured photos 2×2. Leave empty to disable.',
			},
		},
	],
};

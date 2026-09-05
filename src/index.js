import InterfaceComponent from './interface.vue';

export default {
	id: 'grdelina-photo-grid',
	name: 'Photo Grid',
	icon: 'grid_view',
	description: 'Large-thumbnail photo grid for M2M-to-files fields, with a Small/Large size toggle, drag reorder, and click-to-enlarge preview.',
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
	],
};

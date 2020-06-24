// Power BI API Dependencies
    import powerbi from 'powerbi-visuals-api';
    import DataView = powerbi.DataView;

// Internal dependencies
    import { ViewModelHandler, IViewModel } from '../src/ViewModel';
    import { VisualSettings } from '../src/VisualSettings';

// Seed constants for tests
    const 
        vmEmpty: IViewModel = {
            isValid: false,
            isEmpty: true,
            contentIndex: -1,
            htmlEntries: []
        },
        dataViewEmpty: DataView[] = [],
        contentMetadata = {
            displayName: 'HTML',
            roles: {
                content: true
            }
        },
        samplingMetadata = {
            displayName: 'HTML',
            roles: {
                sampling: true
            }
        },
        dataViewNoValues: DataView[] = [
            {
                table: {
                    columns: [],
                    rows: []
                },
                metadata: {
                    columns: [
                        contentMetadata
                    ]
                }
            }
        ],
        dataViewNoValuesSamplingOnly: DataView[] = [
            {
                table: {
                    columns: [],
                    rows: []
                },
                metadata: {
                    columns: [
                        samplingMetadata
                    ]
                }
            }
        ],
        dataViewSimpleValues: DataView[] = [
            {
                table: {
                    columns: [],
                    rows: [
                        [
                            "<p>This is value <b>one</b></p>"
                        ],
                        [
                            "<p>This is value <b>two</b></p>"
                        ],
                        [
                            "<p>This is value <b>three</b></p>"
                        ]
                    ]
                },
                metadata: {
                    columns: [
                        contentMetadata
                    ]
                }
            }
        ],
        dataViewSimpleValuesWithSampling: DataView[] = [
            {
                table: {
                    columns: [],
                    rows: [
                        [   
                            "1",
                            "<p>This is value <b>one</b></p>"
                        ],
                        [
                            "2",
                            "<p>This is value <b>two</b></p>"
                        ],
                        [
                            "3",
                            "<p>This is value <b>three</b></p>"
                        ]
                    ]
                },
                metadata: {
                    columns: [
                        samplingMetadata,
                        contentMetadata
                    ]
                }
            }
        ];

// Common setup
    function newVm(): ViewModelHandler {
        return new ViewModelHandler();
    }
    function newVmValidate(dv: DataView[]): ViewModelHandler {
        const vm = newVm();
        vm.validateDataView(dv);
        return vm;
    }
    function newVmValidateMap(dv: DataView[]): ViewModelHandler {
        const vm = newVmValidate(dv);
        vm.mapDataView(dv, VisualSettings.parse(dv[0]));
        return vm;
    }

// View model unit tests
    describe('View Model', () => {

        describe('| Initialisation', () => {
        
            it('| Empty view model', () => {
                expect(newVm().viewModel).toEqual(vmEmpty);
            });

        });

        describe('| Validate data view', () => {

            it('| Empty data view', () => {
                expect(newVmValidate(dataViewEmpty).viewModel.isValid).toBeFalse();
            });

            it('| Valid data view with no results', () => {
                const vm = newVmValidate(dataViewNoValuesSamplingOnly);
                expect(vm.viewModel.contentIndex).toEqual(-1);
                expect(vm.viewModel.isValid).toBeFalse();
            });

            it('| Valid data view with no content', () => {
                const vm = newVmValidate(dataViewNoValues)
                expect(vm.viewModel.contentIndex).toEqual(0);
                expect(vm.viewModel.isValid).toBeTrue();
            });

            it('| Valid data view with some results', () => {
                const vm = newVmValidate(dataViewSimpleValues);
                expect(vm.viewModel.contentIndex).toEqual(0);
                expect(vm.viewModel.isValid).toBeTrue();
            });

            it('| Valid data view with sampling and some results', () => {
                const vm = newVmValidate(dataViewSimpleValuesWithSampling);
                expect(vm.viewModel.contentIndex).toEqual(1);
                expect(vm.viewModel.isValid).toBeTrue();
            });

        });

        describe('| Map data view', () => {

            it('| Empty data view', () => {
                expect(newVmValidateMap(dataViewEmpty).viewModel).toEqual(vmEmpty);
            });

            it('| Valid data view with no results', () => {
                const vm = newVmValidateMap(dataViewNoValues);
                expect(vm.viewModel.isEmpty).toBeTrue();
                expect(vm.viewModel.htmlEntries.length).toEqual(0);
            });

            it('| Valid data view with some results', () => {
                const vm = newVmValidateMap(dataViewSimpleValues);
                expect(vm.viewModel.isEmpty).toBeFalse();
                expect(vm.viewModel.htmlEntries.length).toEqual(3);
            });

            it('| Valid data view with sampling and some results', () => {
                const vm = newVmValidateMap(dataViewSimpleValuesWithSampling);
                expect(vm.viewModel.isEmpty).toBeFalse();
                expect(vm.viewModel.htmlEntries.length).toEqual(3);
            });

        });

        // TODO: Settings

    });